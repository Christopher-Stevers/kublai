import { z } from "zod";
import { point3Schema } from "./types";
import { assertSimpleOutline } from "./cad-outline-validation";
export const designKinds = {
  pipe: "Pipe",
  duct: "Duct",
  elbow: "Elbow",
  tee: "Tee",
  valve: "Valve",
  pump: "Pump",
  tank: "Tank",
  equipment: "Equipment",
  wall: "Wall",
  slab: "Slab",
  box: "Custom object",
  line: "Line",
  polyline: "Polyline",
  rectangle: "Rectangle",
  circle: "Circle",
  profile: "Extruded profile",
  solid: "Solid",
  dimension: "Dimension",
} as const;
export type DesignKind = keyof typeof designKinds;
const boundedPoint = point3Schema.refine(
  (p) => p.every((v) => Math.abs(v) <= 1e8),
  "Coordinates and rotations must be within the supported range.",
);
const dimension = z.number().finite().min(0.001).max(1000);
export const cadMeshSchema = z
  .object({
    positions: z
      .array(z.number().finite().min(-1e8).max(1e8))
      .min(9)
      .max(300000),
    indices: z.array(z.number().int().nonnegative()).min(3).max(600000),
  })
  .superRefine((mesh, ctx) => {
    if (
      mesh.positions.length % 3 ||
      mesh.indices.length % 3 ||
      mesh.indices.some((i) => i >= mesh.positions.length / 3)
    )
      ctx.addIssue({
        code: "custom",
        message: "The solid contains invalid triangles.",
      });
  });
export type CadMesh = z.infer<typeof cadMeshSchema>;
export const designElementSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    kind: z.enum(Object.keys(designKinds) as DesignKind[]),
    position: boundedPoint,
    rotation: boundedPoint,
    size: z.tuple([dimension, dimension, dimension]),
    diameter: dimension,
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    system: z.string().max(120),
    material: z.string().max(120),
    notes: z.string().max(3000),
    layer: z.string().trim().min(1).max(80).optional(),
    // Sketch vertices use the element's local XY plane; placement and rotation
    // retain the same world-metre convention as all model objects.
    points: z.array(boundedPoint).min(2).max(512).optional(),
    scale: z
      .tuple([z.number(), z.number(), z.number()])
      .refine(
        (values) =>
          values.every(
            (v) =>
              Number.isFinite(v) && Math.abs(v) >= 0.001 && Math.abs(v) <= 1000,
          ),
        "Scale must be between 0.001 and 1000, with no zero axes.",
      )
      .optional(),
    mesh: cadMeshSchema.optional(),
    dimension: z
      .object({
        offset: z.number().finite().min(-1000).max(1000),
        unit: z.enum(["m", "mm", "ft", "in"]),
        precision: z.number().int().min(0).max(4),
        anchors: z
          .array(
            z
              .object({
                id: z.string().uuid(),
                anchor: z.number().int().min(0).max(4096),
              })
              .nullable(),
          )
          .length(2)
          .optional(),
      })
      .optional(),
  })
  .superRefine((element, ctx) => {
    if (
      element.kind === "dimension" &&
      (element.points?.length !== 2 ||
        Math.hypot(
          ...element.points[0]!.map((v, i) => v - element.points![1]![i]!),
        ) < 1e-8)
    )
      ctx.addIssue({
        code: "custom",
        message: "A dimension needs two different endpoints.",
      });
    if (element.kind === "solid" && !element.mesh)
      ctx.addIssue({
        code: "custom",
        message: "A solid needs its triangle geometry.",
      });
    if (
      [
        "line",
        "polyline",
        "rectangle",
        "circle",
        "profile",
        "dimension",
      ].includes(element.kind) &&
      (!element.points ||
        element.points.length < (element.kind === "profile" ? 3 : 2))
    )
      ctx.addIssue({
        code: "custom",
        message: "A sketch needs vertices before it can be saved.",
      });
    if (element.kind === "profile" && element.points) {
      const points = element.points;
      const area =
        Math.abs(
          points.reduce((sum, p, i) => {
            const q = points[(i + 1) % points.length]!;
            return sum + p[0] * q[1] - q[0] * p[1];
          }, 0),
        ) / 2;
      if (area < 1e-8 || points.some((p) => Math.abs(p[2]) > 1e-6))
        ctx.addIssue({
          code: "custom",
          message: "An extrusion needs a flat outline with a non-zero area.",
        });
      try {
        assertSimpleOutline(points, true);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message:
            error instanceof Error
              ? error.message
              : "Repair the extrusion outline.",
        });
      }
    }
  });
export type DesignElement = z.infer<typeof designElementSchema>;
export const designOverrideSchema = z.object({
  expressId: z.number().int().positive(),
  name: z.string().max(160),
  translation: boundedPoint,
  rotation: boundedPoint,
  deleted: z.boolean(),
});
export type DesignOverride = z.infer<typeof designOverrideSchema>;
export const cadComponentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    elements: z.array(designElementSchema).min(1).max(100),
  })
  .refine(
    (c) => new Set(c.elements.map((e) => e.id)).size === c.elements.length,
    "Component object IDs must be unique.",
  );
export type CadComponent = z.infer<typeof cadComponentSchema>;
export const designSchema = z
  .object({
    elements: z.array(designElementSchema).max(2000),
    overrides: z.array(designOverrideSchema).max(5000),
    components: z.array(cadComponentSchema).max(50).optional(),
    layers: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          visible: z.boolean(),
          locked: z.boolean(),
        }),
      )
      .max(100)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const all = [
      ...value.elements,
      ...(value.components ?? []).flatMap((c) => c.elements),
    ];
    if (
      all.reduce(
        (n, e) =>
          n + (e.mesh?.positions.length ?? 0) + (e.mesh?.indices.length ?? 0),
        0,
      ) > 900000
    )
      ctx.addIssue({
        code: "custom",
        message:
          "This design is too detailed to save. Split the solids into separate designs.",
      });
    if (JSON.stringify(value).length > 7_500_000)
      ctx.addIssue({
        code: "custom",
        message: "This design exceeds 7.5 MB. Split it into separate designs.",
      });
    if (all.reduce((count, e) => count + (e.points?.length ?? 0), 0) > 50000)
      ctx.addIssue({
        code: "custom",
        message:
          "This design exceeds 50,000 sketch vertices. Split it into separate models.",
      });
    if (
      new Set(value.elements.map((e) => e.id)).size !== value.elements.length ||
      new Set(value.overrides.map((e) => e.expressId)).size !==
        value.overrides.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Each element must have a unique ID.",
      });
    if (
      new Set(value.components?.map((c) => c.id)).size !==
      (value.components?.length ?? 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Component IDs must be unique.",
      });
    const names = value.layers?.map((layer) => layer.name) ?? [];
    if (new Set(names).size !== names.length)
      ctx.addIssue({ code: "custom", message: "Layer names must be unique." });
    if (
      value.layers &&
      value.elements.some((e) => !names.includes(e.layer ?? "Design"))
    )
      ctx.addIssue({
        code: "custom",
        message: "Every object must belong to an existing layer.",
      });
  });
export type ModelDesign = z.infer<typeof designSchema>;
export type SavedModelDesign = {
  revision: number;
  design: ModelDesign;
  updatedAt: string | null;
  updatedBy: string | null;
};
export const emptyDesign = (): ModelDesign => ({ elements: [], overrides: [] });
export function newDesignElement(
  kind: DesignKind,
  position: [number, number, number],
): DesignElement {
  const round = ["pipe", "elbow", "tee", "valve"].includes(kind);
  return {
    id: crypto.randomUUID(),
    kind,
    name: designKinds[kind],
    position,
    rotation: [0, 0, 0],
    size:
      kind === "wall"
        ? [3, 2.7, 0.15]
        : kind === "slab"
          ? [3, 0.2, 3]
          : round
            ? [0.1, 1, 0.1]
            : kind === "duct"
              ? [0.4, 1, 0.3]
              : [1, 1, 1],
    diameter: 0.1,
    color: round ? "#38bdf8" : "#f59e0b",
    system: "",
    material: "",
    notes: "",
    layer: "Design",
    ...(kind === "solid"
      ? {
          mesh: {
            positions: [
              -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5,
              -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
              0.5,
            ],
            indices: [
              0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1,
              6, 5, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3,
            ],
          },
        }
      : {}),
    ...(kind === "dimension"
      ? { dimension: { offset: 0.2, unit: "m" as const, precision: 2 } }
      : {}),
    ...([
      "line",
      "polyline",
      "rectangle",
      "circle",
      "profile",
      "dimension",
    ].includes(kind)
      ? {
          points:
            kind === "rectangle" || kind === "profile"
              ? [
                  [0, 0, 0],
                  [1, 0, 0],
                  [1, 1, 0],
                  [0, 1, 0],
                  [0, 0, 0],
                ]
              : kind === "circle"
                ? Array.from({ length: 65 }, (_, i) => [
                    Math.cos((i * Math.PI) / 32),
                    Math.sin((i * Math.PI) / 32),
                    0,
                  ])
                : [
                    [0, 0, 0],
                    [1, 1, 0],
                  ],
        }
      : {}),
  };
}
