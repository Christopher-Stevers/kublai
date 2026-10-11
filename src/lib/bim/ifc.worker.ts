/// <reference lib="webworker" />
import {
  IfcAPI,
  IFCBUILDINGSTOREY,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  LogLevel,
} from "web-ifc";
import {
  elementKey,
  MAX_MODEL_BYTES,
  type BimElement,
  type BimProperties,
} from "./types";
import type { IfcPart, IfcReply, IfcRequest } from "./worker-protocol";
const api = new IfcAPI();
const models = new Map<string, number>();
let initialization: Promise<void> | undefined;
const send = (reply: IfcReply, transfers: Transferable[] = []) =>
  self.postMessage(reply, transfers);
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function scalar(value: unknown): string {
  if (value == null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  const v = record(value);
  return "value" in v ? scalar(v.value) : "";
}
function line(model: number, id: number) {
  return record(api.GetLine(model, id));
}
async function load(modelId: string, url: string) {
  if (!initialization) {
    api.SetWasmPath(
      new URL("/api/models/wasm/", self.location.origin).href,
      true,
    );
    initialization = api
      .Init(undefined, true)
      .then(() => api.SetLogLevel(LogLevel.LOG_LEVEL_ERROR));
  }
  await initialization;
  if (models.has(modelId)) api.CloseModel(models.get(modelId)!);
  send({
    type: "progress",
    modelId,
    progress: 2,
    message: "Downloading model",
  });
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok)
    throw Error(
      response.status === 401
        ? "Sign in again to open this model."
        : "The model could not be downloaded.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw Error("The model file is empty.");
  const size = Number(response.headers.get("content-length")) || 0;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_MODEL_BYTES) {
      await reader.cancel();
      throw Error("This model exceeds the 250 MB viewing limit.");
    }
    chunks.push(next.value);
    send({
      type: "progress",
      modelId,
      progress: Math.min(20, size ? (20 * total) / size : 10),
      message: "Downloading model",
    });
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  chunks.length = 0;
  const model = api.OpenModel(data, {
    COORDINATE_TO_ORIGIN: false,
    CIRCLE_SEGMENTS: 24,
    MEMORY_LIMIT: 512 * 1024 * 1024,
    ALLOW_INCOMPATIBLE_SCHEMA_ALIASES: false,
  });
  if (model < 0 || !api.IsModelOpen(model))
    throw Error(
      "The IFC model could not be read. Export IFC2x3, IFC4, or IFC4.3 from the authoring program.",
    );
  models.set(modelId, model);
  const floorMap = new Map<number, { key: string; name: string }>();
  const storeys = api.GetLineIDsWithType(model, IFCBUILDINGSTOREY);
  const names = new Map<number, string>();
  for (let i = 0; i < storeys.size(); i++) {
    const id = storeys.get(i);
    names.set(id, scalar(line(model, id).Name) || `Level ${i + 1}`);
  }
  const relationships = api.GetLineIDsWithType(
    model,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
  );
  for (let i = 0; i < relationships.size(); i++) {
    const rel = line(model, relationships.get(i));
    const id = Number(record(rel.RelatingStructure).value);
    const name = names.get(id);
    if (!name) continue;
    for (const ref of Array.isArray(rel.RelatedElements)
      ? rel.RelatedElements
      : []) {
      floorMap.set(Number(record(ref).value), {
        key: elementKey(modelId, id),
        name,
      });
    }
  }
  let parts: IfcPart[] = [];
  let pending: BimElement[] = [];
  const elements: BimElement[] = [];
  let vertexCount = 0;
  let bytes = 0;
  const flush = () => {
    if (!parts.length) return;
    send(
      { type: "geometry", modelId, parts, elements: pending },
      parts.flatMap(
        (p) => [p.vertices.buffer, p.indices.buffer] as ArrayBuffer[],
      ),
    );
    parts = [];
    pending = [];
    bytes = 0;
  };
  api.StreamAllMeshes(model, (mesh, index, count) => {
    const props = line(model, mesh.expressID);
    const level = floorMap.get(mesh.expressID);
    const element: BimElement = {
      key: elementKey(modelId, mesh.expressID),
      modelId,
      expressId: mesh.expressID,
      guid: scalar(props.GlobalId),
      name: scalar(props.Name) || `Element ${mesh.expressID}`,
      type: api.GetNameFromTypeCode(Number(api.GetLineType(model, mesh.expressID))),
      level: level?.key ?? "",
      levelName: level?.name ?? "Unassigned",
    };
    elements.push(element);
    pending.push(element);
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const placed = mesh.geometries.get(i);
      const geometry = api.GetGeometry(model, placed.geometryExpressID);
      try {
        const vertices = api
          .GetVertexArray(
            geometry.GetVertexData(),
            geometry.GetVertexDataSize(),
          )
          .slice();
        const indices = api
          .GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize())
          .slice();
        vertexCount += vertices.length / 6;
        if (vertexCount > 6_000_000)
          throw Error(
            "This model is too detailed for this device viewer. Export a smaller discipline or floor model.",
          );
        bytes += vertices.byteLength + indices.byteLength;
        parts.push({
          expressId: mesh.expressID,
          vertices,
          indices,
          matrix: placed.flatTransformation,
          color: [
            placed.color.x,
            placed.color.y,
            placed.color.z,
            placed.color.w,
          ],
        });
        if (parts.length >= 96 || bytes > 4 * 1024 * 1024) flush();
      } finally {
        geometry.delete();
      }
    }
    if (index % 50 === 0)
      send({
        type: "progress",
        modelId,
        progress: 20 + (75 * (index + 1)) / Math.max(1, count),
        message: "Building model geometry",
      });
  });
  flush();
  if (!elements.length) throw Error("This IFC has no viewable 3D elements.");
  send({ type: "ready", modelId, elements, schema: api.GetModelSchema(model) });
}
function flatten(
  value: unknown,
  group: string,
  path: string,
  rows: BimProperties,
  depth = 0,
  seen = new Set<unknown>(),
) {
  if (value == null || depth > 5 || rows.length >= 2000) return;
  const v = record(value);
  const simple = scalar(value);
  if (simple !== "") {
    rows.push({ group, name: path, value: simple.slice(0, 4000) });
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value
      .slice(0, 100)
      .forEach((item, i) =>
        flatten(
          item,
          group,
          path ? `${path} ${i + 1}` : String(i + 1),
          rows,
          depth + 1,
          seen,
        ),
      );
    return;
  }
  const name = scalar(v.Name);
  if (
    name &&
    ("NominalValue" in v ||
      "LengthValue" in v ||
      "AreaValue" in v ||
      "VolumeValue" in v ||
      "CountValue" in v)
  ) {
    const key = [
      "NominalValue",
      "LengthValue",
      "AreaValue",
      "VolumeValue",
      "CountValue",
      "WeightValue",
    ].find((k) => k in v)!;
    rows.push({ group, name, value: scalar(v[key]) });
    return;
  }
  for (const [key, item] of Object.entries(v)) {
    if (
      [
        "expressID",
        "type",
        "OwnerHistory",
        "ObjectPlacement",
        "Representation",
        "GlobalId",
      ].includes(key)
    )
      continue;
    flatten(
      item,
      depth === 0 && name ? `${group} · ${name}` : group,
      path ? `${path} / ${key}` : key,
      rows,
      depth + 1,
      seen,
    );
  }
}
self.onmessage = (event: MessageEvent<IfcRequest>) => {
  const request = event.data;
  void (async () => {
    if (request.type === "load") return load(request.modelId, request.url);
    const model = models.get(request.modelId);
    if (model === undefined) throw Error("Open the model first.");
    if (request.type === "close") {
      api.CloseModel(model);
      models.delete(request.modelId);
      return;
    }
    const rows: BimProperties = [];
    flatten(api.GetLine(model, request.expressId), "Element", "", rows);
    for (const [name, read] of [
      [
        "Properties",
        () => api.properties.getPropertySets(model, request.expressId, true),
      ],
      [
        "Type",
        () => api.properties.getTypeProperties(model, request.expressId, true),
      ],
      [
        "Materials",
        () =>
          api.properties.getMaterialsProperties(model, request.expressId, true),
      ],
    ] as const) {
      const groups: unknown[] = await read();
      for (const group of groups) flatten(group, name, "", rows);
    }
    send({
      type: "properties",
      modelId: request.modelId,
      requestId: request.requestId,
      properties: rows,
    });
  })().catch((error: unknown) => {
    if (request.type === "load") {
      const model = models.get(request.modelId);
      if (model !== undefined) {
        api.CloseModel(model);
        models.delete(request.modelId);
      }
    }
    send({
      type: "error",
      modelId: request.modelId,
      requestId: request.type === "properties" ? request.requestId : undefined,
      message:
        error instanceof Error ? error.message : "The model could not be read.",
    });
  });
};
