/// <reference lib="webworker" />
import { deviceModelDownload } from "./device-model-cache";
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
import {
  readMeshParts,
  releaseVector,
  viewableElementIds,
} from "./ifc-geometry";
import { ModelLoadFlow } from "./model-load-flow";
const api = new IfcAPI();
const models = new Map<string, number>();
const loading = new Map<string, { loadId: number; flow: ModelLoadFlow }>();
function close(modelId: string) {
  loading.get(modelId)?.flow.cancel();
  loading.delete(modelId);
  const model = models.get(modelId);
  if (model !== undefined) api.CloseModel(model);
  models.delete(modelId);
}
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
async function load(
  modelId: string,
  loadId: number,
  url: string,
  flow: ModelLoadFlow,
  installedApp: boolean,
) {
  const progress = (value: number, message: string) =>
    send({
      type: "progress",
      modelId,
      loadId,
      progress: value,
      message,
    });
  if (!initialization) {
    api.SetWasmPath(
      new URL("/api/models/wasm/", self.location.origin).href,
      true,
    );
    initialization = api
      .Init(undefined, true)
      .then(() => api.SetLogLevel(LogLevel.LOG_LEVEL_ERROR))
      .catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });
  }
  await initialization;
  flow.check();
  progress(2, installedApp ? "Checking saved model" : "Downloading model");
  const model = await downloadAndOpen(url, flow, progress, installedApp);
  models.set(modelId, model);
  await flow.yield();
  const floorMap = new Map<number, { key: string; name: string }>();
  const storeys = api.GetLineIDsWithType(model, IFCBUILDINGSTOREY);
  const names = new Map<number, string>();
  try {
    for (let i = 0; i < storeys.size(); i++) {
      const id = storeys.get(i);
      names.set(id, scalar(line(model, id).Name) || `Level ${i + 1}`);
    }
  } finally {
    releaseVector(storeys);
  }
  const relationships = api.GetLineIDsWithType(
    model,
    IFCRELCONTAINEDINSPATIALSTRUCTURE,
  );
  try {
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
  } finally {
    releaseVector(relationships);
  }
  const ids = viewableElementIds(api, model);
  const cache: Parameters<typeof readMeshParts>[3] = new Map();
  let parts: IfcPart[] = [],
    pending: BimElement[] = [];
  const elements: BimElement[] = [];
  const transfers = new Set<ArrayBuffer>();
  let bytes = 0,
    chunkId = 0,
    lastYield = performance.now();
  const flush = async () => {
    if (!parts.length) {
      await flow.yield();
      return;
    }
    const accepted = flow.waitForChunk(++chunkId);
    send(
      { type: "geometry", modelId, loadId, chunkId, parts, elements: pending },
      [...transfers],
    );
    parts = [];
    pending = [];
    cache.clear();
    transfers.clear();
    bytes = 0;
    await accepted;
    flow.check();
  };
  for (let index = 0; index < ids.length; index++) {
    flow.check();
    const expressId = ids[index]!;
    const incoming = readMeshParts(api, model, expressId, cache);
    if (incoming.length) {
      const props = line(model, expressId);
      const level = floorMap.get(expressId);
      const element: BimElement = {
        key: elementKey(modelId, expressId),
        modelId,
        expressId,
        guid: scalar(props.GlobalId),
        name: scalar(props.Name) || `Element ${expressId}`,
        type: api.GetNameFromTypeCode(
          Number(api.GetLineType(model, expressId)),
        ),
        level: level?.key ?? "",
        levelName: level?.name ?? "Unassigned",
      };
      elements.push(element);
      pending.push(element);
      for (const part of incoming) {
        parts.push(part);
        for (const buffer of [
          part.positions.buffer,
          part.normals.buffer,
          part.indices.buffer,
        ] as ArrayBuffer[]) {
          if (!transfers.has(buffer)) {
            transfers.add(buffer);
            bytes += buffer.byteLength;
          }
        }
      }
    }
    if (
      parts.length >= 96 ||
      bytes >= 2 * 1024 * 1024 ||
      performance.now() - lastYield >= 40
    ) {
      progress(
        20 + (75 * (index + 1)) / Math.max(1, ids.length),
        "Building model geometry",
      );
      await flush();
      lastYield = performance.now();
    }
  }
  await flush();
  if (!elements.length) throw Error("This IFC has no viewable 3D elements.");
  send({
    type: "ready",
    modelId,
    loadId,
    elements,
    schema: api.GetModelSchema(model),
  });
}

// Separate scope releases the source bytes before streamed geometry processing.
async function downloadAndOpen(
  url: string,
  flow: ModelLoadFlow,
  progress: (value: number, message: string) => void,
  installedApp: boolean,
) {
  const download = await deviceModelDownload(url, flow.signal, installedApp);
  const { response } = download;
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
  let total = 0,
    lastProgress = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      flow.check();
      total += next.value.byteLength;
      if (total > MAX_MODEL_BYTES) {
        await reader.cancel();
        throw Error("This model exceeds the 250 MB viewing limit.");
      }
      chunks.push(next.value);
      if (performance.now() - lastProgress > 100) {
        progress(
          Math.min(20, size ? (20 * total) / size : 10),
          download.cached ? "Opening saved model" : "Downloading model",
        );
        lastProgress = performance.now();
      }
    }
  } finally {
    reader.releaseLock();
  }
  flow.check();
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  chunks.length = 0;
  progress(20, "Reading model structure");
  await flow.yield();
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
  await download.save(data);
  return model;
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
    if (request.type === "close") return close(request.modelId);
    if (request.type === "ack") {
      const session = loading.get(request.modelId);
      if (session?.loadId === request.loadId)
        session.flow.acknowledge(request.chunkId);
      return;
    }
    if (request.type === "load") {
      close(request.modelId);
      const flow = new ModelLoadFlow();
      const session = { loadId: request.loadId, flow };
      loading.set(request.modelId, session);
      try {
        await load(
          request.modelId,
          request.loadId,
          request.url,
          flow,
          request.installedApp === true,
        );
      } catch (error) {
        if (!flow.signal.aborted) {
          close(request.modelId);
          send({
            type: "error",
            modelId: request.modelId,
            loadId: request.loadId,
            message:
              error instanceof Error
                ? error.message
                : "The model could not be read.",
          });
        }
      } finally {
        if (loading.get(request.modelId) === session)
          loading.delete(request.modelId);
      }
      return;
    }
    const model = models.get(request.modelId);
    if (model === undefined) throw Error("Open the model first.");
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
    send({
      type: "error",
      modelId: request.modelId,
      requestId: request.type === "properties" ? request.requestId : undefined,
      message:
        error instanceof Error ? error.message : "The model could not be read.",
    });
  });
};
