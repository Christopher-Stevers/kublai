import DxfParser from "dxf-parser";
import * as THREE from "three";
import type { IEntity, IPoint } from "dxf-parser/dist/entities/geomtry";
import type { IInsertEntity } from "dxf-parser/dist/entities/insert";
import { newDesignElement, type DesignElement } from "./design";
import type { Point3 } from "./types";
export type DxfUnits = "file" | "m" | "mm" | "ft" | "in";
export type DxfImport = {
  elements: DesignElement[];
  layers: { name: string; visible: boolean; locked: boolean }[];
  warnings: string[];
  units: string;
};
type Entity = IEntity & {
  vertices?: (IPoint & { bulge?: number })[];
  shape?: boolean;
  is3dPolyline?: boolean;
  is3dPolygonMesh?: boolean;
  isPolyfaceMesh?: boolean;
  elevation?: number;
  center?: IPoint;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  majorAxisEndPoint?: IPoint;
  axisRatio?: number;
};
const vector = (p?: Partial<IPoint>) =>
  new THREE.Vector3(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
const coord = (p: THREE.Vector3) => new THREE.Vector3(p.x, p.z, -p.y);
function arcSweep(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw Error("The DXF contains invalid arc angles.");
  const full = 2 * Math.PI;
  return (((end - start) % full) + full) % full || full;
}
function ocs(normal: THREE.Vector3) {
  if (normal.lengthSq() < 1e-12)
    throw Error("The DXF contains an invalid extrusion direction.");
  normal.normalize();
  const x = (
    Math.abs(normal.x) < 1 / 64 && Math.abs(normal.y) < 1 / 64
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1)
  )
    .cross(normal)
    .normalize();
  return new THREE.Matrix4().makeBasis(x, normal.clone().cross(x), normal);
}
/** ASCII DXF model-space linework; block references become independently editable objects. */
export function importDxf(text: string, units: DxfUnits = "file"): DxfImport {
  if (text.length > 8_000_000) throw Error("Choose a DXF smaller than 8 MB.");
  if (text.startsWith("AutoCAD Binary DXF"))
    throw Error("Save the drawing as ASCII DXF before importing.");
  // Preserve OCS normals that some upstream entity handlers omit.
  const normals = new Map<string, THREE.Vector3>(),
    elevations = new Map<string, number>(),
    raw = text.split(/\r\n|\n|\r/),
    rawSkipped = new Map<string, number>();
  let handle = "",
    normal = new THREE.Vector3(0, 0, 1),
    hasNormal = false,
    rawType = "",
    elevation = 0,
    section = "",
    sectionName = false;
  const known = new Set([
    "POINT",
    "3DFACE",
    "ARC",
    "ATTDEF",
    "CIRCLE",
    "DIMENSION",
    "ELLIPSE",
    "INSERT",
    "LINE",
    "LWPOLYLINE",
    "MTEXT",
    "POLYLINE",
    "SOLID",
    "SPLINE",
    "TEXT",
    "VERTEX",
    "SEQEND",
    "ENDSEC",
    "BLOCK",
    "ENDBLK",
  ]);
  const flush = () => {
    if (
      hasNormal &&
      !handle &&
      normal.distanceTo(new THREE.Vector3(0, 0, 1)) > 1e-8
    )
      throw Error(
        "This DXF has tilted entities without handles. Resave it as a modern ASCII DXF before importing.",
      );
    if (handle && hasNormal) normals.set(handle, normal);
    if (handle && rawType === "POLYLINE") elevations.set(handle, elevation);
  };
  for (let i = 0; i < raw.length - 1; i += 2) {
    const code = Number(raw[i]!.trim()),
      value = raw[i + 1]!.trim();
    if (code === 0) {
      flush();
      handle = "";
      normal = new THREE.Vector3(0, 0, 1);
      hasNormal = false;
      elevation = 0;
      rawType = value;
      if (value === "SECTION") sectionName = true;
      else if (value === "ENDSEC") section = "";
      else if (section === "ENTITIES" && !known.has(value))
        rawSkipped.set(value, (rawSkipped.get(value) ?? 0) + 1);
      else if (section === "BLOCKS" && !known.has(value)) {
        const label = `${value} in block definitions`;
        rawSkipped.set(label, (rawSkipped.get(label) ?? 0) + 1);
      }
    } else if (code === 2 && sectionName) {
      section = value;
      sectionName = false;
    } else if (code === 5) handle = value;
    else if (code === 30 && rawType === "POLYLINE") elevation = Number(value);
    else if ([210, 220, 230].includes(code)) {
      normal.setComponent((code - 210) / 10, Number(value));
      hasNormal = true;
    }
  }
  flush();
  const parsed = new DxfParser().parseSync(text);
  if (!parsed) throw Error("This DXF could not be read.");
  const unitCode = Number(parsed.header?.$INSUNITS ?? 0),
    supported: Record<number, [number, string]> = {
      1: [0.0254, "in"],
      2: [0.3048, "ft"],
      4: [0.001, "mm"],
      5: [0.01, "cm"],
      6: [1, "m"],
      7: [1000, "km"],
      10: [0.9144, "yd"],
    };
  const declared = supported[unitCode];
  if (units === "file" && !declared)
    throw Error(
      "This DXF has no supported unit declaration. Choose its units before importing.",
    );
  const factor =
    units === "file"
      ? declared![0]
      : { m: 1, mm: 0.001, ft: 0.3048, in: 0.0254 }[units];
  const elements: DesignElement[] = [],
    layers = new Map<
      string,
      { name: string; visible: boolean; locked: boolean }
    >(),
    skipped = new Map(rawSkipped);
  let vertexCount = 0;
  const skip = (type: string) =>
    skipped.set(type, (skipped.get(type) ?? 0) + 1);
  const emit = (
    e: Entity,
    points: THREE.Vector3[],
    transform: THREE.Matrix4,
    normal: THREE.Vector3,
    layerName: string,
    color: number,
  ) => {
    if (points.length < 2) return;
    const world = points.map((p) =>
      coord(p.clone().applyMatrix4(transform)).multiplyScalar(factor),
    );
    const n = coord(
      normal
        .clone()
        .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(transform)),
    ).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        n,
      ),
      inverse = q.clone().invert(),
      angles = new THREE.Euler().setFromQuaternion(q),
      position = world[0]!;
    const object = newDesignElement(
      world.length === 2 ? "line" : "polyline",
      position.toArray() as Point3,
    );
    object.points = world.map(
      (p) =>
        p
          .clone()
          .sub(position)
          .applyQuaternion(inverse)
          .toArray()
          .map((v) => (Math.abs(v) < 1e-8 ? 0 : v)) as Point3,
    );
    object.rotation = [angles.x, angles.y, angles.z].map(
      THREE.MathUtils.radToDeg,
    ) as Point3;
    object.name = `${layerName} · ${e.type}`.slice(0, 160);
    object.layer = layerName;
    object.color = "#" + (color & 0xffffff).toString(16).padStart(6, "0");
    if (object.color === "#000000") object.color = "#cbd5e1";
    vertexCount += world.length;
    if (world.length > 512 || vertexCount > 50000 || elements.length >= 2000)
      throw Error(
        "The DXF exceeds this design's editing capacity. Import a smaller drawing or split complex polylines.",
      );
    elements.push(object);
  };
  const process = (
    e: Entity,
    parent: THREE.Matrix4,
    depth = 0,
    parentLayer = "0",
    parentColor = 0xcbd5e1,
    stack: string[] = [],
  ) => {
    if (e.inPaperSpace) {
      skip("paper-space objects");
      return;
    }
    if (e.visible === false) {
      skip("hidden objects");
      return;
    }
    const layerName =
      (e.layer === "0" ? parentLayer : e.layer || parentLayer) || "DXF";
    if (layerName.length > 80)
      throw Error("Shorten DXF layer names to 80 characters before importing.");
    const record = parsed.tables?.layer?.layers?.[layerName];
    layers.set(layerName, {
      name: layerName,
      visible: record?.visible !== false && !record?.frozen,
      locked: false,
    });
    const color =
      e.colorIndex === 0
        ? parentColor
        : (e.color ?? record?.color ?? parentColor);
    const normal =
      normals.get(String(e.handle))?.clone() ?? new THREE.Vector3(0, 0, 1);
    if (e.type === "INSERT") {
      const insert = e as unknown as IInsertEntity,
        block = parsed.blocks?.[insert.name];
      if (!block) {
        skip(`missing block ${insert.name}`);
        return;
      }
      if (depth > 8 || stack.includes(insert.name))
        throw Error("The DXF contains recursive or excessively nested blocks.");
      const rows = insert.rowCount || 1,
        cols = insert.columnCount || 1;
      if (rows * cols > 1000)
        throw Error(
          "The DXF block array is too large. Split it before importing.",
        );
      const base = parent
        .clone()
        .multiply(ocs(normal))
        .multiply(
          new THREE.Matrix4().makeTranslation(
            ...(vector(insert.position).toArray() as Point3),
          ),
        )
        .multiply(
          new THREE.Matrix4().makeRotationZ(
            THREE.MathUtils.degToRad(insert.rotation || 0),
          ),
        );
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
          const transform = base
            .clone()
            .multiply(
              new THREE.Matrix4().makeTranslation(
                col * (insert.columnSpacing || 0),
                row * (insert.rowSpacing || 0),
                0,
              ),
            )
            .multiply(
              new THREE.Matrix4().makeScale(
                insert.xScale ?? 1,
                insert.yScale ?? 1,
                insert.zScale ?? 1,
              ),
            )
            .multiply(
              new THREE.Matrix4().makeTranslation(
                ...(vector(block.position).negate().toArray() as Point3),
              ),
            );
          for (const child of block.entities ?? [])
            process(child as Entity, transform, depth + 1, layerName, color, [
              ...stack,
              insert.name,
            ]);
        }
      return;
    }
    if (e.type === "LINE") {
      emit(e, (e.vertices ?? []).map(vector), parent, normal, layerName, color);
      return;
    }
    if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
      if (e.isPolyfaceMesh || e.is3dPolygonMesh) {
        skip(e.type + " mesh");
        return;
      }
      const points: THREE.Vector3[] = [],
        vertices = e.vertices ?? [],
        closed = !!e.shape;
      if (vertices.length > 512)
        throw Error(
          "Split polylines with more than 512 vertices before importing.",
        );
      for (let i = 0; i < vertices.length; i++) {
        if (points.length > 512)
          throw Error(
            "Split complex polylines into smaller curves before importing.",
          );
        const a = vertices[i]!,
          b = vertices[(i + 1) % vertices.length]!,
          start = vector({
            ...a,
            z: e.is3dPolyline
              ? (a.z ?? 0)
              : e.type === "POLYLINE"
                ? (elevations.get(String(e.handle)) ?? 0)
                : (a.z ?? e.elevation ?? 0),
          });
        points.push(start);
        const bulge = a.bulge ?? 0;
        if (!bulge || (!closed && i === vertices.length - 1)) continue;
        if (e.is3dPolyline)
          throw Error("A 3D polyline cannot contain planar bulge arcs.");
        const chord = new THREE.Vector2(b.x - a.x, b.y - a.y),
          length = chord.length();
        if (length < 1e-10) continue;
        const middle = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2),
          centre = middle.add(
            new THREE.Vector2(-chord.y, chord.x).multiplyScalar(
              (1 - bulge * bulge) / (4 * bulge),
            ),
          );
        const radius = Math.hypot(a.x - centre.x, a.y - centre.y),
          angle = Math.atan2(a.y - centre.y, a.x - centre.x),
          sweep = 4 * Math.atan(bulge),
          count = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
        for (let j = 1; j < count; j++)
          points.push(
            new THREE.Vector3(
              centre.x + radius * Math.cos(angle + (sweep * j) / count),
              centre.y + radius * Math.sin(angle + (sweep * j) / count),
              start.z,
            ),
          );
      }
      if (closed && points.length) points.push(points[0]!.clone());
      const transform = e.is3dPolyline
        ? parent
        : parent.clone().multiply(ocs(normal));
      emit(
        e,
        points,
        transform,
        e.is3dPolyline ? normal : new THREE.Vector3(0, 0, 1),
        layerName,
        color,
      );
      return;
    }
    if (e.type === "CIRCLE" || e.type === "ARC") {
      const start = e.type === "CIRCLE" ? 0 : (e.startAngle ?? 0);
      const sweep =
        e.type === "CIRCLE"
          ? Math.PI * 2
          : arcSweep(start, e.endAngle ?? Math.PI * 2);
      const count = Math.max(2, Math.ceil(sweep / (Math.PI / 48))),
        centre = vector(e.center),
        radius = e.radius ?? 0;
      if (radius <= 0)
        throw Error("The DXF contains an invalid circle radius.");
      const points = Array.from({ length: count + 1 }, (_, i) =>
        centre
          .clone()
          .add(
            new THREE.Vector3(
              radius * Math.cos(start + (sweep * i) / count),
              radius * Math.sin(start + (sweep * i) / count),
              0,
            ),
          ),
      );
      emit(
        e,
        points,
        parent.clone().multiply(ocs(normal)),
        new THREE.Vector3(0, 0, 1),
        layerName,
        color,
      );
      return;
    }
    if (e.type === "ELLIPSE") {
      const major = vector(e.majorAxisEndPoint),
        minor = normal
          .clone()
          .cross(major)
          .normalize()
          .multiplyScalar(major.length() * (e.axisRatio ?? 1)),
        centre = vector(e.center),
        start = e.startAngle ?? 0;
      const sweep = arcSweep(start, e.endAngle ?? 2 * Math.PI);
      const count = Math.max(2, Math.ceil(sweep / (Math.PI / 48)));
      emit(
        e,
        Array.from({ length: count + 1 }, (_, i) =>
          centre
            .clone()
            .addScaledVector(major, Math.cos(start + (sweep * i) / count))
            .addScaledVector(minor, Math.sin(start + (sweep * i) / count)),
        ),
        parent,
        normal,
        layerName,
        color,
      );
      return;
    }
    skip(e.type);
  };
  for (const e of parsed.entities ?? [])
    process(e as Entity, new THREE.Matrix4());
  if (!elements.length)
    throw Error(
      "This DXF contains no supported model-space linework. Import lines, polylines, arcs, circles, ellipses or blocks containing them.",
    );
  if (layers.size > 100)
    throw Error("This DXF has more than 100 layers. Import a smaller drawing.");
  return {
    elements,
    layers: [...layers.values()],
    warnings: [...skipped].map(([type, count]) => `${count} ${type} skipped`),
    units: units === "file" ? declared![1] : units,
  };
}
