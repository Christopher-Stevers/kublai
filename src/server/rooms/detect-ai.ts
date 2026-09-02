import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import sharp from "sharp";

import {
  pointInPolygon,
  type RoomPoint,
  type RoomPolygonShape,
} from "~/lib/room-shape";
import { unionRoomFaces } from "~/server/rooms/polygonize-walls";

export type AiDetectedRoom = {
  name: string;
  shape: RoomPolygonShape;
};

export type DetectRoomHint = {
  name?: string;
  bbox?: { x: number; y: number; w: number; h: number };
  point?: { x: number; y: number };
};

export type RoomFaceTarget = {
  id: string;
  name: string;
  point: RoomPoint;
};

const OPENCLAW_AUTH_DB =
  process.env.OPENCLAW_AUTH_DB ??
  "/home/halvor/.openclaw/agents/main/agent/openclaw-agent.sqlite";

const SKIP_NAME =
  /\b(title|legend|north arrow|grid bubble|drawing title|sheet)\b/i;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function polygonArea(points: Array<{ x: number; y: number }>) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function polygonBounds(shape: RoomPolygonShape) {
  const xs = shape.points.map((point) => point.x);
  const ys = shape.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    w: Math.max(...xs) - x,
    h: Math.max(...ys) - y,
  };
}

function polygonCenter(shape: RoomPolygonShape) {
  const box = polygonBounds(shape);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isKeepableRoomName(name: string) {
  const compact = name.replace(/\s+/g, "");
  if (SKIP_NAME.test(name)) return false;
  return compact.length >= 1 && compact.length <= 80;
}

export function expandDetectHint(hint: DetectRoomHint): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const minHalf = 0.11;
  if (hint.bbox) {
    const cx = hint.bbox.x + hint.bbox.w / 2;
    const cy = hint.bbox.y + hint.bbox.h / 2;
    const halfW = Math.max(hint.bbox.w / 2 + 0.06, minHalf);
    const halfH = Math.max(hint.bbox.h / 2 + 0.06, minHalf);
    const x = clamp01(cx - halfW);
    const y = clamp01(cy - halfH);
    const x2 = clamp01(cx + halfW);
    const y2 = clamp01(cy + halfH);
    return { x, y, w: Math.max(0.08, x2 - x), h: Math.max(0.08, y2 - y) };
  }
  const point = hint.point ?? { x: 0.5, y: 0.5 };
  const x = clamp01(point.x - minHalf);
  const y = clamp01(point.y - minHalf);
  const x2 = clamp01(point.x + minHalf);
  const y2 = clamp01(point.y + minHalf);
  return { x, y, w: Math.max(0.08, x2 - x), h: Math.max(0.08, y2 - y) };
}

function oneRoomPrompt(name?: string) {
  const target = name?.trim();
  return `Trace ONE enclosed room on this crop as a tight wall polygon.
${target ? `Room name: ${target}. Label is near the center.` : "Trace the room that contains the image center."}
Return ONLY JSON: {"name":"${target || "ROOM"}","points":[{"x":0.12,"y":0.18},{"x":0.86,"y":0.18},{"x":0.86,"y":0.84},{"x":0.12,"y":0.84}]}
x,y are 0-1 from the TOP-LEFT of THIS image. 4-16 clockwise wall corners. Vertices MUST sit on wall corners. Follow the interior face of the walls. No neighboring rooms.`;
}

const ALL_ROOMS_PROMPT = `Trace EVERY enclosed room on this architectural floor plan, not just apartment suites.
Return ONLY JSON:
{"rooms":[{"name":"N901","points":[{"x":0.12,"y":0.18},{"x":0.22,"y":0.18},{"x":0.22,"y":0.32},{"x":0.12,"y":0.32}]}]}
Rules:
- Include suites, bedrooms, bathrooms, kitchens, corridors, stairs, closets, mechanical, electrical, and any other enclosed room with walls.
- Use the label on the drawing as the name. If unlabeled, use a short type name like Bath, Closet, Corridor.
- Skip title blocks, legends, north arrows, and the overall building outline.
- x,y are 0-1 from the TOP-LEFT of THIS image.
- Vertices MUST sit on wall corners / wall intersections. Follow the interior face of the walls. Include jogs and notches. Do not draw a loose box around a label.
- 4-24 clockwise vertices per room. Tight to the walls.
- Do not invent rooms that are not drawn.`;

function pickXaiAccess(storeJson: string): string | null {
  const store = JSON.parse(storeJson) as {
    profiles?: Record<
      string,
      { provider?: string; access?: string; expires?: number }
    >;
  };
  const now = Date.now();
  const xai = Object.values(store.profiles ?? {}).find(
    (profile) =>
      profile.provider === "xai" &&
      typeof profile.access === "string" &&
      profile.access.length > 20 &&
      (profile.expires == null || profile.expires > now),
  );
  return xai?.access ?? null;
}

function readXaiTokenFromNodeSqlite(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        options?: { readOnly?: boolean },
      ) => {
        prepare: (sql: string) => {
          get: (key: string) => { store_json?: string } | undefined;
        };
        close: () => void;
      };
    };
    const db = new DatabaseSync(OPENCLAW_AUTH_DB, { readOnly: true });
    const row = db
      .prepare("select store_json from auth_profile_store where store_key = ?")
      .get("primary");
    db.close();
    if (!row?.store_json) return null;
    return pickXaiAccess(row.store_json);
  } catch (error) {
    console.warn(
      "[detect-ai] node sqlite token read failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function readXaiTokenFromPython(): string | null {
  try {
    const script = `
import json, os, sqlite3, sys, time
path = os.environ.get("OPENCLAW_AUTH_DB", "")
con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
row = con.execute("select store_json from auth_profile_store where store_key='primary'").fetchone()
if not row:
    raise SystemExit(1)
store = json.loads(row[0])
now = time.time() * 1000
for p in (store.get("profiles") or {}).values():
    access = p.get("access")
    if (
        p.get("provider") == "xai"
        and isinstance(access, str)
        and len(access) > 20
        and (p.get("expires") is None or p.get("expires") > now)
    ):
        sys.stdout.write(access)
        raise SystemExit(0)
raise SystemExit(1)
`.trim();
    const token = execFileSync("python3", ["-c", script], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, OPENCLAW_AUTH_DB },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return token.length > 20 ? token : null;
  } catch (error) {
    console.warn(
      "[detect-ai] python sqlite token read failed",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function readXaiAccessToken(): string | null {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  const token = readXaiTokenFromPython() ?? readXaiTokenFromNodeSqlite();
  if (token) {
    console.log("[detect-ai] using OpenClaw xAI token, length", token.length);
  }
  return token;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("AI did not return JSON room shapes");
  }
}

function rawPointsFrom(record: {
  points?: unknown;
  polygon?: unknown;
  shape?: { points?: unknown };
}) {
  if (Array.isArray(record.points)) return record.points;
  if (Array.isArray(record.polygon)) return record.polygon;
  if (Array.isArray(record.shape?.points)) return record.shape.points;
  return [];
}

function parseOneRoom(
  payload: unknown,
  mapPoint: (x: number, y: number) => { x: number; y: number },
  sentWidth: number,
  sentHeight: number,
  fallbackName?: string,
): AiDetectedRoom {
  const root = payload as {
    name?: unknown;
    points?: unknown;
    polygon?: unknown;
    shape?: { points?: unknown };
    room?: unknown;
    rooms?: unknown;
  };
  const candidates: unknown[] = Array.isArray(root.rooms)
    ? root.rooms
    : root.room
      ? [root.room]
      : [root];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as {
      name?: unknown;
      points?: unknown;
      polygon?: unknown;
      shape?: { points?: unknown };
    };
    const name = String(record.name ?? fallbackName ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name || name.length > 80) continue;
    if (!fallbackName && !isKeepableRoomName(name)) continue;

    const points = rawPointsFrom(record)
      .map((point) => {
        if (Array.isArray(point) && point.length >= 2) {
          const x = Number(point[0]);
          const y = Number(point[1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          const nx = x > 1 ? x / sentWidth : x;
          const ny = y > 1 ? y / sentHeight : y;
          return mapPoint(nx, ny);
        }
        if (!point || typeof point !== "object") return null;
        const x = Number((point as { x?: unknown }).x);
        const y = Number((point as { y?: unknown }).y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const nx = x > 1 ? x / sentWidth : x;
        const ny = y > 1 ? y / sentHeight : y;
        return mapPoint(nx, ny);
      })
      .filter((point): point is { x: number; y: number } => point != null);

    const unique = points.filter((point, index) => {
      const prev = points[index - 1];
      return !prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 0.002;
    });
    if (unique.length < 3) continue;
    const area = polygonArea(unique);
    if (area < 0.00005 || area > 0.45) continue;
    return {
      name: fallbackName || name,
      shape: {
        type: "polygon",
        points: unique.slice(0, 40),
      },
    };
  }

  throw new Error("AI did not find a dwelling unit there");
}

function collectRoomCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  for (const key of ["rooms", "units", "apartments", "polygons", "shapes"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
  }
  if (root.room && typeof root.room === "object") return [root.room];
  if (root.name || root.points || root.polygon) return [root];
  return [];
}

function parseAllRooms(
  payload: unknown,
  mapPoint: (x: number, y: number) => { x: number; y: number },
  sentWidth: number,
  sentHeight: number,
): AiDetectedRoom[] {
  const rooms = collectRoomCandidates(payload);
  const detected: AiDetectedRoom[] = [];
  let skipped = 0;
  for (const room of rooms) {
    try {
      detected.push(parseOneRoom(room, mapPoint, sentWidth, sentHeight));
    } catch {
      skipped += 1;
    }
    if (detected.length >= 40) break;
  }
  console.log(
    "[detect-ai] parsed rooms",
    detected.length,
    "candidates",
    rooms.length,
    "skipped",
    skipped,
    "topKeys",
    payload && typeof payload === "object"
      ? Object.keys(payload as object).slice(0, 8)
      : [],
  );
  return detected;
}

async function callVisionModel(imageJpeg: Buffer, prompt: string) {
  const apiKey =
    process.env.XAI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    readXaiAccessToken();
  if (!apiKey) {
    throw new Error(
      "AI room detection is not configured. Add an XAI or OpenAI API key.",
    );
  }

  const xai = Boolean(process.env.XAI_API_KEY) || !process.env.OPENAI_API_KEY;
  const url = xai
    ? "https://api.x.ai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const model = xai
    ? (process.env.XAI_VISION_MODEL ?? "grok-4.6")
    : (process.env.OPENAI_VISION_MODEL ?? "gpt-4o");

  console.log("[detect-ai] calling", model, "jpegBytes", imageJpeg.length);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      reasoning_effort: xai ? "low" : undefined,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageJpeg.toString("base64")}`,
                detail: "high",
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const body = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (!response.ok) {
    console.error(
      "[detect-ai] vision failed",
      response.status,
      body.error?.message,
    );
    throw new Error(
      body.error?.message ?? `Vision API failed (${response.status})`,
    );
  }
  console.log("[detect-ai] vision ok", model);
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Vision API returned no room shapes");
  }
  return content;
}

async function prepareRoomCrop(image: Buffer, hint: DetectRoomHint) {
  const rotatedBuffer = await sharp(image).rotate().toBuffer();
  const original = await sharp(rotatedBuffer).metadata();
  const origWidth = original.width ?? 1;
  const origHeight = original.height ?? 1;
  const crop = expandDetectHint(hint);
  const left = Math.max(
    0,
    Math.min(origWidth - 32, Math.round(crop.x * origWidth)),
  );
  const top = Math.max(
    0,
    Math.min(origHeight - 32, Math.round(crop.y * origHeight)),
  );
  const width = Math.max(
    32,
    Math.min(origWidth - left, Math.round(crop.w * origWidth)),
  );
  const height = Math.max(
    32,
    Math.min(origHeight - top, Math.round(crop.h * origHeight)),
  );
  const jpeg = await sharp(rotatedBuffer)
    .extract({ left, top, width, height })
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 75 })
    .toBuffer();
  const sent = await sharp(jpeg).metadata();
  const actualX = left / origWidth;
  const actualY = top / origHeight;
  const actualW = width / origWidth;
  const actualH = height / origHeight;

  return {
    jpeg,
    sentWidth: sent.width ?? 1024,
    sentHeight: sent.height ?? 1024,
    mapPoint(x: number, y: number) {
      return {
        x: clamp01(actualX + clamp01(x) * actualW),
        y: clamp01(actualY + clamp01(y) * actualH),
      };
    },
  };
}

function targetCrop(targets: RoomFaceTarget[]) {
  const xs = targets.map((target) => target.point.x);
  const ys = targets.map((target) => target.point.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const halfW = Math.max(
    0.085,
    (Math.max(...xs) - Math.min(...xs)) / 2 + 0.055,
  );
  const halfH = Math.max(
    0.085,
    (Math.max(...ys) - Math.min(...ys)) / 2 + 0.055,
  );
  const x = clamp01(centerX - halfW);
  const y = clamp01(centerY - halfH);
  const x2 = clamp01(centerX + halfW);
  const y2 = clamp01(centerY + halfH);
  return { x, y, w: Math.max(0.08, x2 - x), h: Math.max(0.08, y2 - y) };
}

async function prepareFaceOverlay(
  image: Buffer,
  targets: RoomFaceTarget[],
  faces: RoomPolygonShape[],
) {
  const crop = targetCrop(targets);
  const intersectsCrop = (face: RoomPolygonShape) => {
    const box = polygonBounds(face);
    return (
      box.x < crop.x + crop.w &&
      box.x + box.w > crop.x &&
      box.y < crop.y + crop.h &&
      box.y + box.h > crop.y
    );
  };
  const distanceToTarget = (face: RoomPolygonShape) => {
    const center = polygonCenter(face);
    return Math.min(
      ...targets.map((target) =>
        Math.hypot(center.x - target.point.x, center.y - target.point.y),
      ),
    );
  };
  const nearby = faces
    .filter(intersectsCrop)
    .sort((left, right) => distanceToTarget(left) - distanceToTarget(right));
  const required = faces.filter((face) =>
    targets.some((target) => pointInPolygon(target.point, face)),
  );
  const candidates = [...required, ...nearby]
    .filter((face, index, list) => list.indexOf(face) === index)
    .slice(0, 90);

  const rotated = await sharp(image).rotate().toBuffer();
  const metadata = await sharp(rotated).metadata();
  const imageWidth = metadata.width ?? 1;
  const imageHeight = metadata.height ?? 1;
  const left = Math.max(
    0,
    Math.min(imageWidth - 1, Math.floor(crop.x * imageWidth)),
  );
  const top = Math.max(
    0,
    Math.min(imageHeight - 1, Math.floor(crop.y * imageHeight)),
  );
  const width = Math.max(
    1,
    Math.min(imageWidth - left, Math.ceil(crop.w * imageWidth)),
  );
  const height = Math.max(
    1,
    Math.min(imageHeight - top, Math.ceil(crop.h * imageHeight)),
  );
  const size = 1200;
  const localPoint = (point: RoomPoint) => ({
    x: ((point.x - crop.x) / crop.w) * size,
    y: ((point.y - crop.y) / crop.h) * size,
  });
  const polygons = candidates
    .map((face, index) => {
      const id = index + 1;
      const points = face.points
        .map((point) => {
          const local = localPoint(point);
          return `${local.x.toFixed(1)},${local.y.toFixed(1)}`;
        })
        .join(" ");
      const center = localPoint(polygonCenter(face));
      const hue = (id * 47) % 360;
      return `<polygon points="${points}" fill="hsla(${hue},85%,55%,0.18)" stroke="hsl(${hue},85%,38%)" stroke-width="3"/><text x="${center.x.toFixed(1)}" y="${center.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" paint-order="stroke" stroke="white" stroke-width="5" fill="#111">${id}</text>`;
    })
    .join("");
  const markers = targets
    .map((target, index) => {
      const point = localPoint(target.point);
      return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="11" fill="#ef4444" stroke="white" stroke-width="4"/><text x="${(point.x + 16).toFixed(1)}" y="${(point.y - 14).toFixed(1)}" font-family="Arial,sans-serif" font-size="25" font-weight="700" paint-order="stroke" stroke="white" stroke-width="6" fill="#b91c1c">T${index + 1} ${escapeXml(target.name)}</text>`;
    })
    .join("");
  const svg = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${polygons}${markers}</svg>`,
  );
  const jpeg = await sharp(rotated)
    .extract({ left, top, width, height })
    .resize({ width: size, height: size, fit: "fill" })
    .composite([{ input: svg }])
    .jpeg({ quality: 86 })
    .toBuffer();
  return { jpeg, candidates };
}

export async function selectRoomPolygonsFromFaces(
  image: Buffer,
  targets: RoomFaceTarget[],
  faces: RoomPolygonShape[],
  ownershipTargets: RoomFaceTarget[] = targets,
): Promise<AiDetectedRoom[]> {
  if (targets.length === 0 || faces.length === 0) return [];
  const limitedTargets = targets.slice(0, 4);
  const prepared = await prepareFaceOverlay(image, limitedTargets, faces);
  if (prepared.candidates.length === 0) return [];
  const prompt = `The numbered translucent shapes are exact planar faces extracted from this architectural PDF. Red markers T1, T2, etc. show exact text-label positions.
For every target, select ALL and ONLY face IDs belonging to that enclosed room or dwelling suite.
- A dwelling suite such as N901 includes its bedrooms, bathrooms, kitchen, closets, and living area inside the suite's exterior/demising walls.
- A normal room label such as CORRIDOR, STAIR, or ELEC CLOSET includes only that labelled enclosed space.
- Internal walls, dimensions, grids, hatching, and furniture may split one target into multiple numbered faces; include all of those faces.
- Never include a neighboring suite, corridor, exterior area, title block, or wall cavity.
Return ONLY JSON: {"rooms":[{"target":"T1","ids":[1,2,3]}]}
Targets: ${limitedTargets.map((target, index) => `T${index + 1}=${target.name}`).join(", ")}`;
  const content = await callVisionModel(prepared.jpeg, prompt);
  const payload = extractJsonObject(content) as {
    rooms?: Array<{ target?: unknown; ids?: unknown }>;
  };
  const selections = Array.isArray(payload.rooms) ? payload.rooms : [];
  const results: AiDetectedRoom[] = [];
  for (
    let targetIndex = 0;
    targetIndex < limitedTargets.length;
    targetIndex += 1
  ) {
    const target = limitedTargets[targetIndex]!;
    const targetId = `T${targetIndex + 1}`;
    const selection = selections.find(
      (item) => String(item.target ?? "").toUpperCase() === targetId,
    );
    const ids = Array.isArray(selection?.ids)
      ? selection.ids.map(Number).filter(Number.isInteger)
      : [];
    const selected = ids.flatMap((id) => {
      const face = prepared.candidates[id - 1];
      return face ? [face] : [];
    });
    for (const face of prepared.candidates) {
      if (pointInPolygon(target.point, face) && !selected.includes(face)) {
        selected.push(face);
      }
    }
    const owned = selected.filter((face) => {
      if (pointInPolygon(target.point, face)) return true;
      const center = polygonCenter(face);
      const nearest = ownershipTargets.reduce(
        (best, candidate) => {
          const distance = Math.hypot(
            center.x - candidate.point.x,
            center.y - candidate.point.y,
          );
          return !best || distance < best.distance
            ? { target: candidate, distance }
            : best;
        },
        null as { target: RoomFaceTarget; distance: number } | null,
      );
      return nearest?.target.id === target.id;
    });
    const shape = unionRoomFaces(owned, target.point);
    if (shape) results.push({ name: target.name, shape });
  }
  console.log(
    "[detect-ai] selected wall faces",
    results.length,
    "of",
    limitedTargets.length,
    "from",
    prepared.candidates.length,
  );
  return results;
}

export async function detectOneRoomFromFloorImage(
  image: Buffer,
  hint: DetectRoomHint,
): Promise<AiDetectedRoom> {
  const prepared = await prepareRoomCrop(image, hint);
  const content = await callVisionModel(
    prepared.jpeg,
    oneRoomPrompt(hint.name),
  );
  return parseOneRoom(
    extractJsonObject(content),
    prepared.mapPoint,
    prepared.sentWidth,
    prepared.sentHeight,
    hint.name,
  );
}

async function prepareFloorImage(image: Buffer) {
  const rotatedBuffer = await sharp(image).rotate().toBuffer();
  const jpeg = await sharp(rotatedBuffer)
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  const sent = await sharp(jpeg).metadata();
  return {
    jpeg,
    sentWidth: sent.width ?? 2048,
    sentHeight: sent.height ?? 2048,
    mapPoint(x: number, y: number) {
      return { x: clamp01(x), y: clamp01(y) };
    },
  };
}

export async function detectAllRoomsFromFloorImage(
  image: Buffer,
): Promise<AiDetectedRoom[]> {
  const prepared = await prepareFloorImage(image);
  const content = await callVisionModel(prepared.jpeg, ALL_ROOMS_PROMPT);
  console.log("[detect-ai] raw vision", content.slice(0, 500));
  const rooms = parseAllRooms(
    extractJsonObject(content),
    prepared.mapPoint,
    prepared.sentWidth,
    prepared.sentHeight,
  );
  if (rooms.length === 0) {
    throw new Error("AI did not find any dwelling units on this floor plan");
  }
  return rooms;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await fn(items[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

function bboxFromRoom(room: AiDetectedRoom) {
  const xs = room.shape.points.map((point) => point.x);
  const ys = room.shape.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    w: Math.max(0.01, Math.max(...xs) - x),
    h: Math.max(0.01, Math.max(...ys) - y),
  };
}

export async function refineDetectedRooms(
  image: Buffer,
  rooms: AiDetectedRoom[],
): Promise<AiDetectedRoom[]> {
  const limited = rooms.slice(0, 24);
  console.log("[detect-ai] recropping", limited.length, "rooms");
  return mapPool(limited, 2, async (room) => {
    try {
      const refined = await detectOneRoomFromFloorImage(image, {
        name: room.name,
        bbox: bboxFromRoom(room),
      });
      return { ...refined, name: room.name };
    } catch (error) {
      console.warn(
        "[detect-ai] recrop failed",
        room.name,
        error instanceof Error ? error.message : error,
      );
      return room;
    }
  });
}

function centroid(room: AiDetectedRoom) {
  const xs = room.shape.points.map((point) => point.x);
  const ys = room.shape.points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

export async function labelRoomPolygons(
  image: Buffer,
  rooms: AiDetectedRoom[],
): Promise<AiDetectedRoom[]> {
  if (rooms.length === 0) return rooms;
  const prepared = await prepareFloorImage(image);
  const catalog = rooms.map((room, id) => {
    const box = bboxFromRoom(room);
    const center = centroid(room);
    return {
      id,
      guess: room.name,
      cx: Number(center.x.toFixed(3)),
      cy: Number(center.y.toFixed(3)),
      w: Number(box.w.toFixed(3)),
      h: Number(box.h.toFixed(3)),
    };
  });
  const prompt = `These polygons were traced from the drawing's own wall lines. Do NOT invent new coordinates.
Name each room from the label nearest its center. Reject title blocks, legends, furniture, exterior courtyard, and bogus faces.
Return ONLY JSON:
{"rooms":[{"id":0,"name":"N901","keep":true}]}
Candidates:
${JSON.stringify(catalog)}`;
  try {
    const content = await callVisionModel(prepared.jpeg, prompt);
    const payload = extractJsonObject(content) as {
      rooms?: Array<{ id?: unknown; name?: unknown; keep?: unknown }>;
    };
    const named = Array.isArray(payload.rooms) ? payload.rooms : [];
    const kept: AiDetectedRoom[] = [];
    for (const item of named) {
      const id = Number(item.id);
      const room = rooms[id];
      if (!room) continue;
      if (item.keep === false) continue;
      const name = String(item.name ?? room.name)
        .replace(/\s+/g, " ")
        .trim();
      if (!name || !isKeepableRoomName(name)) continue;
      kept.push({ ...room, name });
    }
    console.log("[detect-ai] labeled", kept.length, "of", rooms.length);
    return kept.length ? kept : rooms;
  } catch (error) {
    console.warn(
      "[detect-ai] label failed",
      error instanceof Error ? error.message : error,
    );
    return rooms;
  }
}
