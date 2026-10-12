import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { cadMeshSchema, type CadMesh } from "./design";
export type SolidOperation = "union" | "subtract" | "intersect" | "convert";
export type SolidRequest = {
  operation: SolidOperation;
  objects: { name: string; meshes: CadMesh[] }[];
};
export type SolidResult = { mesh: CadMesh; volume: number; area: number };

/** Real manifold booleans, with explicit ownership of every WASM allocation. */
export function evaluateSolid(
  kernel: ManifoldToplevel,
  request: SolidRequest,
): SolidResult {
  if (
    !["union", "subtract", "intersect", "convert"].includes(
      request.operation,
    ) ||
    request.objects.length < (request.operation === "convert" ? 1 : 2) ||
    request.objects.length > 100
  )
    throw Error("Select between two and 100 solids.");
  if (
    request.objects.reduce(
      (sum, o) => sum + o.meshes.reduce((n, m) => n + m.indices.length, 0),
      0,
    ) > 1_200_000
  )
    throw Error("This operation is too large. Work on a smaller selection.");
  const owned = new Set<Manifold>();
  const keep = (solid: Manifold) => {
    owned.add(solid);
    return solid;
  };
  const check = (solid: Manifold, name: string) => {
    const status = solid.status();
    if (status !== "NoError")
      throw Error(
        `${name}: geometry is not a closed solid (${status}). Repair the source geometry before combining it.`,
      );
    return solid;
  };
  try {
    const operands = request.objects.map((object) => {
      if (!object.meshes.length)
        throw Error(
          `${object.name}: extrude linework before using solid operations.`,
        );
      const pieces = object.meshes.map((input) => {
        const data = cadMeshSchema.parse(input);
        const mesh = new kernel.Mesh({
          numProp: 3,
          vertProperties: new Float32Array(data.positions),
          triVerts: new Uint32Array(data.indices),
        });
        mesh.merge();
        try {
          return check(keep(kernel.Manifold.ofMesh(mesh)), object.name);
        } catch {
          throw Error(
            `${object.name}: geometry is not a closed solid. Repair the source geometry before combining it.`,
          );
        }
      });
      return pieces.length === 1
        ? pieces[0]!
        : check(keep(kernel.Manifold.union(pieces)), object.name);
    });
    const result = keep(
      request.operation === "union" || request.operation === "convert"
        ? kernel.Manifold.union(operands)
        : request.operation === "subtract"
          ? kernel.Manifold.difference(operands)
          : kernel.Manifold.intersection(operands),
    );
    check(result, "Result");
    if (result.isEmpty())
      throw Error(
        "The operation produced no solid. Check that the objects overlap and that subtraction leaves material.",
      );
    const mesh = result.getMesh();
    const positions: number[] = [];
    for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp)
      positions.push(
        mesh.vertProperties[i]!,
        mesh.vertProperties[i + 1]!,
        mesh.vertProperties[i + 2]!,
      );
    return {
      mesh: cadMeshSchema.parse({
        positions,
        indices: Array.from(mesh.triVerts),
      }),
      volume: result.volume(),
      area: result.surfaceArea(),
    };
  } finally {
    for (const solid of owned) solid.delete();
  }
}
