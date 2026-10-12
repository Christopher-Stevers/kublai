import { designSchema, type ModelDesign } from "./design";
import { designLayers, objectMatrix } from "./cad-geometry";
import * as THREE from "three";
import { dimensionGeometry } from "./cad-dimensions";
export const CAD_FORMAT = "foremanhq-cad";
export function serializeCad(design: ModelDesign, modelId: string) {
  return JSON.stringify(
    {
      format: CAD_FORMAT,
      version: 1,
      units: "metres",
      modelId,
      design: designSchema.parse(design),
    },
    null,
    2,
  );
}
export function parseCad(text: string, modelId: string): ModelDesign {
  if (text.length > 8_000_000) throw Error("The drawing file is too large.");
  const data = JSON.parse(text) as {
    format?: unknown;
    version?: unknown;
    units?: unknown;
    modelId?: unknown;
    design?: unknown;
  };
  if (
    data.format !== CAD_FORMAT ||
    data.version !== 1 ||
    data.units !== "metres"
  )
    throw Error("Choose a ForemanHQ CAD file (version 1, metres).");
  const design = designSchema.parse(data.design);
  if (data.modelId !== modelId && design.overrides.length)
    throw Error(
      "This file contains edits to a different source model. Import it into the original model to keep element references correct.",
    );
  return design;
}
/** Portable DXF centreline/outline export. Solid bodies remain in the CAD file.
 * 3D POLYLINE (flag 8) retains elevation instead of flattening it to plan. */
export function designDxf(design: ModelDesign) {
  const values: (string | number)[] = [];
  const pair = (code: number, value: string | number) =>
    values.push(code, value);
  pair(0, "SECTION");
  pair(2, "HEADER");
  pair(9, "$ACADVER");
  pair(1, "AC1027");
  pair(9, "$INSUNITS");
  pair(70, 6);
  pair(0, "ENDSEC");
  pair(0, "SECTION");
  pair(2, "TABLES");
  pair(0, "TABLE");
  pair(2, "LAYER");
  pair(5, "A");
  pair(100, "AcDbSymbolTable");
  pair(70, designLayers(design).length);
  for (const layer of designLayers(design)) {
    pair(0, "LAYER");
    pair(100, "AcDbSymbolTableRecord");
    pair(100, "AcDbLayerTableRecord");
    pair(2, layer.name.replace(/[<>/\\":;?*|=\r\n]/g, "_"));
    pair(70, layer.locked ? 4 : 0);
    pair(62, layer.visible ? 7 : -7);
    pair(6, "CONTINUOUS");
  }
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");
  pair(0, "SECTION");
  pair(2, "ENTITIES");
  for (const e of design.elements) {
    const layer = (e.layer ?? "Design").replace(/[<>/\\":;?*|=\r\n]/g, "_");
    const matrix = objectMatrix(e);
    if (e.kind === "dimension") {
      const annotation = dimensionGeometry(e);
      const xyz = (code: number, p: THREE.Vector3) => {
        pair(code, p.x);
        pair(code + 10, -p.z);
        pair(code + 20, p.y);
      };
      for (let i = 0; i < annotation.lines.length; i += 2) {
        pair(0, "LINE");
        pair(100, "AcDbEntity");
        pair(8, layer);
        pair(420, parseInt(e.color.slice(1), 16));
        pair(100, "AcDbLine");
        xyz(10, annotation.lines[i]!.clone().applyMatrix4(matrix));
        xyz(11, annotation.lines[i + 1]!.clone().applyMatrix4(matrix));
      }
      const x = annotation.direction.clone().transformDirection(matrix),
        up = annotation.normal.clone().transformDirection(matrix),
        normal = x.clone().cross(up).normalize();
      pair(0, "MTEXT");
      pair(100, "AcDbEntity");
      pair(8, layer);
      pair(420, parseInt(e.color.slice(1), 16));
      pair(100, "AcDbMText");
      xyz(10, annotation.labelPoint.applyMatrix4(matrix));
      pair(40, annotation.height);
      pair(41, annotation.height * annotation.label.length);
      pair(71, 5);
      pair(72, 1);
      pair(1, annotation.label);
      xyz(210, normal);
      xyz(11, x);
      continue;
    }
    let points = e.points?.map((p) => new THREE.Vector3(...p));
    if (!points && ["pipe", "duct"].includes(e.kind))
      points = [
        new THREE.Vector3(0, -e.size[1] / 2, 0),
        new THREE.Vector3(0, e.size[1] / 2, 0),
      ];
    if (!points) continue;
    pair(0, "POLYLINE");
    pair(100, "AcDbEntity");
    pair(8, layer);
    pair(420, parseInt(e.color.slice(1), 16));
    pair(100, "AcDb3dPolyline");
    pair(66, 1);
    pair(70, 8);
    pair(10, 0);
    pair(20, 0);
    pair(30, 0);
    for (const point of points) {
      point.applyMatrix4(matrix);
      pair(0, "VERTEX");
      pair(100, "AcDbEntity");
      pair(8, layer);
      pair(100, "AcDbVertex");
      pair(100, "AcDb3dPolylineVertex");
      pair(70, 32);
      pair(10, point.x);
      pair(20, -point.z);
      pair(30, point.y);
    }
    pair(0, "SEQEND");
    pair(100, "AcDbEntity");
    pair(8, layer);
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return values.join("\n") + "\n";
}
export function downloadCadFile(
  contents: string,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([contents], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
