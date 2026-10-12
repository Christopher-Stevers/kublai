import * as THREE from "three";
import type { CadMesh, ModelDesign } from "./design";
import type { Point3 } from "./types";
import { elementMeshes } from "./cad-mesh";
import { objectMatrix } from "./cad-geometry";
import { dimensionGeometry } from "./cad-dimensions";

export type IfcExportObject = {
  id: string;
  name: string;
  kind: string;
  position: Point3;
  meshes: CadMesh[];
  color?: string;
  layer?: string;
  system?: string;
  material?: string;
  notes?: string;
  lines?: Point3[];
  sourceGuid?: string;
  meshColors?: [number, number, number, number][];
  annotation?: {
    segments: Point3[];
    label: string;
    position: Point3;
    direction: Point3;
    normal: Point3;
    height: number;
  };
};
/** IFC compressed GUID: 128 UUID bits in buildingSMART's 64-character alphabet. */
export function ifcGuid(uuid = crypto.randomUUID()) {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let value = BigInt("0x" + uuid.replaceAll("-", "")),
    result = "";
  for (let i = 0; i < 22; i++) {
    result = alphabet[Number(value & 63n)]! + result;
    value >>= 6n;
  }
  return result;
}
export function stepString(value: string) {
  // STEP X2 encodes BMP characters; non-BMP code points require X4, not UTF-16 surrogate pairs.
  let result = "'",
    run = "",
    kind = "";
  const flush = () => {
    if (run) result += `\\${kind}\\${run}\\X0\\`;
    run = "";
  };
  for (const char of value) {
    const code = char.codePointAt(0)!;
    const next =
      code < 32 || code > 126 || char === "\\"
        ? code > 65535
          ? "X4"
          : "X2"
        : "";
    if (next !== kind) {
      flush();
      kind = next;
    }
    if (next)
      run += code
        .toString(16)
        .toUpperCase()
        .padStart(next === "X4" ? 8 : 4, "0");
    else result += char === "'" ? "''" : char;
  }
  flush();
  return result + "'";
}
const number = (n: number) => {
  if (!Number.isFinite(n))
    throw Error("The model contains invalid coordinates.");
  const value =
    Math.abs(n) < 1e-10
      ? "0"
      : n.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
  return value.includes(".") ? value : value + ".";
};
const xyz = (p: number[]) =>
  `(${number(p[0]!)},${number(-p[2]!)},${number(p[1]!)})`;

/** IFC4 reference geometry: final edited shapes, metres, Z up. Not an RVT/DWG rewrite. */
export function designIfc(
  design: ModelDesign,
  title: string,
  source: IfcExportObject[] = [],
) {
  const objects: IfcExportObject[] = [...source];
  for (const e of design.elements) {
    const matrix = objectMatrix(e),
      meshes = e.kind === "dimension" ? [] : elementMeshes(e, e.position);
    if (e.kind === "dimension") {
      const graphic = dimensionGeometry(e),
        origin = new THREE.Vector3(...e.position),
        direction = graphic.direction.clone().transformDirection(matrix),
        up = graphic.normal.clone().transformDirection(matrix);
      const transform = (p: THREE.Vector3) =>
        p.clone().applyMatrix4(matrix).sub(origin).toArray() as Point3;
      objects.push({
        ...e,
        meshes: [],
        annotation: {
          segments: graphic.lines.map(transform),
          label: graphic.label,
          position: transform(graphic.labelPoint),
          direction: direction.toArray() as Point3,
          normal: direction.clone().cross(up).normalize().toArray() as Point3,
          height: graphic.height,
        },
      });
      continue;
    }
    const lines =
      !meshes.length && e.points
        ? e.points.map(
            (p) =>
              new THREE.Vector3(...p)
                .applyMatrix4(matrix)
                .sub(new THREE.Vector3(...e.position))
                .toArray() as Point3,
          )
        : undefined;
    objects.push({ ...e, meshes, lines });
  }
  if (!objects.length) throw Error("Add objects before exporting an IFC.");
  if (
    objects.reduce(
      (sum, o) => sum + o.meshes.reduce((n, m) => n + m.indices.length / 3, 0),
      0,
    ) > 2_000_000
  )
    throw Error(
      "Export a smaller selection or export design objects only (up to two million triangles).",
    );
  const records: string[] = [],
    add = (record: string) => {
      records.push(`#${records.length + 1}=${record};`);
      return `#${records.length}`;
    };
  const point = (p: number[]) => add(`IFCCARTESIANPOINT(${xyz(p)})`);
  const axis = add(`IFCAXIS2PLACEMENT3D(${point([0, 0, 0])},$,$)`);
  const context = add(
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.000001,${axis},$)`,
  );
  const unit = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"),
    areaUnit = add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
    volumeUnit = add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
    angleUnit = add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)");
  const units = add(
    `IFCUNITASSIGNMENT((${unit},${areaUnit},${volumeUnit},${angleUnit}))`,
  );
  const root = add(
    `IFCPROJECT('${ifcGuid()}',$,${stepString(title)},$,$,$,$,(${context}),${units})`,
  );
  const placement = add(`IFCLOCALPLACEMENT($,${axis})`);
  const site = add(
    `IFCSITE('${ifcGuid()}',$,'Site',$,$,${placement},$,$,.ELEMENT.,$,$,$,$,$)`,
  );
  const building = add(
    `IFCBUILDING('${ifcGuid()}',$,${stepString(title)},$,$,${placement},$,$,.ELEMENT.,$,$,$)`,
  );
  const storey = add(
    `IFCBUILDINGSTOREY('${ifcGuid()}',$,'Model',$,$,${placement},$,$,.ELEMENT.,0.)`,
  );
  for (const [parent, child] of [
    [root, site],
    [site, building],
    [building, storey],
  ])
    add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${parent},(${child}))`);
  const contained: string[] = [],
    ids = new Set<string>(),
    surfaceStyles = new Map<string, string>();
  const surfaceStyle = (components: [number, number, number, number]) => {
    const key = components.join(","),
      existing = surfaceStyles.get(key);
    if (existing) return existing;
    const [r, g, b, a] = components.map((n) => THREE.MathUtils.clamp(n, 0, 1));
    const rgb = add(
      `IFCCOLOURRGB($,${number(r!)},${number(g!)},${number(b!)})`,
    );
    const shading = add(`IFCSURFACESTYLESHADING(${rgb},${number(1 - a!)})`),
      style = add(`IFCSURFACESTYLE($,.BOTH.,(${shading}))`);
    surfaceStyles.set(key, style);
    return style;
  };
  for (const object of objects) {
    const items: string[] = [],
      shapes: string[] = [];
    const color = new THREE.Color(object.color ?? "#a3b8ca");
    const rgb = add(
      `IFCCOLOURRGB($,${number(color.r)},${number(color.g)},${number(color.b)})`,
    );
    const curveStyle = add(`IFCCURVESTYLE($,$,$,${rgb},.T.)`);
    for (const [meshIndex, mesh] of object.meshes.entries()) {
      const style = surfaceStyle(
        object.meshColors?.[meshIndex] ?? [color.r, color.g, color.b, 1],
      );
      if (!mesh.indices.length) continue;
      const coords: string[] = [],
        faces: string[] = [];
      for (let i = 0; i < mesh.positions.length; i += 3)
        coords.push(xyz(mesh.positions.slice(i, i + 3)));
      for (let i = 0; i < mesh.indices.length; i += 3)
        faces.push(
          `(${mesh.indices[i]! + 1},${mesh.indices[i + 1]! + 1},${mesh.indices[i + 2]! + 1})`,
        );
      const vertices = add(`IFCCARTESIANPOINTLIST3D((${coords.join(",")}))`);
      const faceSet = add(
        `IFCTRIANGULATEDFACESET(${vertices},$,$,(${faces.join(",")}),$)`,
      );
      add(`IFCSTYLEDITEM(${faceSet},(${style}),$)`);
      items.push(faceSet);
    }
    if (items.length)
      shapes.push(
        add(
          `IFCSHAPEREPRESENTATION(${context},'Body','Tessellation',(${items.join(",")}))`,
        ),
      );
    if (object.lines && object.lines.length > 1) {
      const curve = add(`IFCPOLYLINE((${object.lines.map(point).join(",")}))`);
      add(`IFCSTYLEDITEM(${curve},(${curveStyle}),$)`);
      shapes.push(
        add(`IFCSHAPEREPRESENTATION(${context},'Axis','Curve3D',(${curve}))`),
      );
    }
    if (object.annotation) {
      const a = object.annotation,
        annotations: string[] = [];
      for (let i = 0; i < a.segments.length; i += 2) {
        const curve = add(
          `IFCPOLYLINE((${point(a.segments[i]!)},${point(a.segments[i + 1]!)}))`,
        );
        add(`IFCSTYLEDITEM(${curve},(${curveStyle}),$)`);
        annotations.push(curve);
      }
      const direction = (p: Point3) => add(`IFCDIRECTION(${xyz(p)})`);
      const textAxis = add(
        `IFCAXIS2PLACEMENT3D(${point(a.position)},${direction(a.normal)},${direction(a.direction)})`,
      );
      const extent = add(
        `IFCPLANAREXTENT(${number(a.height * a.label.length)},${number(a.height * 1.5)})`,
      );
      const literal = add(
        `IFCTEXTLITERALWITHEXTENT(${stepString(a.label)},${textAxis},.RIGHT.,${extent},'center')`,
      );
      const font = add(
        `IFCTEXTSTYLEFONTMODEL('ForemanHQ',('sans-serif'),$,$,$,IFCLENGTHMEASURE(${number(a.height)}))`,
      );
      const appearance = add(`IFCTEXTSTYLEFORDEFINEDFONT(${rgb},$)`);
      const textStyle = add(`IFCTEXTSTYLE($,${appearance},$,${font},.T.)`);
      add(`IFCSTYLEDITEM(${literal},(${textStyle}),$)`);
      annotations.push(literal);
      shapes.push(
        add(
          `IFCSHAPEREPRESENTATION(${context},'Annotation','Annotation2D',(${annotations.join(",")}))`,
        ),
      );
    }
    if (!shapes.length) continue;
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${shapes.join(",")}))`);
    const localAxis = add(`IFCAXIS2PLACEMENT3D(${point(object.position)},$,$)`),
      local = add(`IFCLOCALPLACEMENT(${placement},${localAxis})`);
    let guid = /^[0-3][0-9A-Za-z_$]{21}$/.test(object.sourceGuid ?? "")
      ? object.sourceGuid!
      : /^[0-9a-f-]{36}$/i.test(object.id)
        ? ifcGuid(object.id)
        : ifcGuid();
    if (ids.has(guid)) guid = ifcGuid();
    ids.add(guid);
    const product = object.annotation
      ? add(
          `IFCANNOTATION('${guid}',$,${stepString(object.name)},${stepString(object.annotation.label)},'Dimension',${local},${shape})`,
        )
      : add(
          `IFCBUILDINGELEMENTPROXY('${guid}',$,${stepString(object.name)},${object.notes ? stepString(object.notes) : "$"},${stepString(object.kind)},${local},${shape},$,.NOTDEFINED.)`,
        );
    contained.push(product);
    const properties = Object.entries({
      "CAD type": object.kind,
      Layer: object.layer,
      System: object.system,
      "Source GUID": object.sourceGuid,
    })
      .filter(([, v]) => v)
      .map(([key, value]) =>
        add(
          `IFCPROPERTYSINGLEVALUE(${stepString(key)},$,IFCLABEL(${stepString(value!)}),$)`,
        ),
      );
    const pset = add(
      `IFCPROPERTYSET('${ifcGuid()}',$,'ForemanHQ',$,(${properties.join(",")}))`,
    );
    add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',$,$,$,(${product}),${pset})`);
    if (object.material) {
      const material = add(`IFCMATERIAL(${stepString(object.material)},$,$)`);
      add(
        `IFCRELASSOCIATESMATERIAL('${ifcGuid()}',$,$,$,(${product}),${material})`,
      );
    }
    if (object.layer && items.length)
      add(
        `IFCPRESENTATIONLAYERASSIGNMENT(${stepString(object.layer)},$,(${items.join(",")}),$)`,
      );
  }
  if (!contained.length) throw Error("There is no exportable geometry.");
  add(
    `IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',$,$,$,(${contained.join(",")}),${storey})`,
  );
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ForemanHQ CAD geometry and annotations'),'2;1');\nFILE_NAME(${stepString(title + ".ifc")},'${new Date().toISOString()}',('ForemanHQ'),('ForemanHQ'),'ForemanHQ CAD','ForemanHQ','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${records.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
}
