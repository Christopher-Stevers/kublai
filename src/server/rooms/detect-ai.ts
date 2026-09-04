import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import sharp from "sharp";

import {
  pointInPolygon,
  type RoomPoint,
  type RoomPolygonShape,
} from "~/lib/room-shape";
import {
  annotateImagineRoomRegions,
  extractImagineRoomRegions,
  parseImagineRoomAssignments,
} from "~/server/rooms/imagine-room-mask";
import { unionRoomFaces } from "~/server/rooms/polygonize-walls";
import { renderPdfRoomCrop } from "~/server/rooms/pdf-room-crop";

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
  areaSqFt?: number;
};

const OPENCLAW_AUTH_DB =
  process.env.OPENCLAW_AUTH_DB ??
  "/home/halvor/.openclaw/state/openclaw.sqlite";

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
  return `Act like a human reading an architectural floor plan. Trace ONE labelled enclosed space as a tight wall polygon.
${target ? `Target label: ${target}. A red ring marks its exact location.` : "Trace the room that contains the image center."}
Return ONLY JSON: {"name":"${target || "ROOM"}","points":[{"x":0.12,"y":0.18},{"x":0.86,"y":0.18},{"x":0.86,"y":0.84},{"x":0.12,"y":0.84}]}
x,y are 0-1 from the TOP-LEFT of THIS image. Use 4-24 clockwise wall corners.
- Find the continuous wall enclosure around the marked label. Follow the interior face of its walls and include every jog or notch.
- A door symbol or door-width opening in a boundary does not erase the boundary: continue the wall line across the doorway threshold.
- Do not cross a doorway into a corridor, lobby, stair, neighboring room, or other common space.
- Ignore grids, dimensions, leaders, hatching, furniture, fixtures, ceiling patterns, and door-swing arcs.
- If the target is a dwelling/unit code, trace the unit's exterior/demising boundary and include its internal spaces. If it is a normal room name, trace only that room.
- Do not draw a loose box around the label. Vertices must follow visible wall corners.`;
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

const IMAGINE_ROOM_COLOR_PROMPT = `Edit this complete architectural floor-plan page in place. Preserve the entire page composition and every original line, wall, label, room number, symbol, dimension, note, grid, hatch, and title-block element exactly where it is.

Identify every actual enclosed architectural space across the whole page, including dwelling rooms, common rooms, corridors, stairs, closets, storage, mechanical, electrical, and service rooms. Fill the usable interior floor area of every space with one flat, vivid, opaque color. Use clearly different colors for adjacent spaces. Continue each fill across its own door opening to the doorway threshold, but never flow through that doorway into the neighboring room or corridor.

Use only flat fills with no gradients, textures, shadows, highlights, or patterns. Keep walls and wall cavities uncolored. Keep all original black linework and room labels visible above the fills. Do not color the exterior background, drawing border, title block, legends, notes, dimensions, grid bubbles, shafts that are not rooms, furniture, fixtures, hatching, or ceiling patterns. Do not crop, rotate, straighten, redraw, simplify, move, erase, invent, or relabel anything. Return the complete page at the same aspect ratio.`;

const NAMING_RENDER_WIDTH = 4096;

function imagineRoomMappingPrompt(regionIds: number[]) {
  return `Both images show the same architectural page with identical framing, and each extracted region carries the same numbered white badge in both. The first image is the original drawing with legible printed room labels; the badges there are nudged up and to the right so the label underneath stays readable. The second image is the page after rooms were colored, which shows each region's true extent but has unreadable text.

Read the room names from the FIRST image and read the region extents from the SECOND image. Return ONLY JSON:
{"regions":[{"id":1,"name":"S319","include":true,"confidence":0.98}]}

Rules:
- Return exactly one entry for every region id: ${regionIds.join(", ")}.
- Transcribe the printed room tag exactly as drawn, character for character, including suite numbers such as N901 or S319 and unit types such as MICRO or 1 BD. Do not translate, expand, tidy, or renumber a printed tag.
- Never substitute a generic description when a tag is printed inside or against the region. Generic names such as "Residential unit" are only allowed when the region genuinely carries no printed tag.
- If a region covers several tagged spaces, name it after the largest tagged space it covers.
- For an unlabeled real room, use a concise stable description such as "Unlabeled Closet 12".
- include=true for dwelling rooms, common rooms, corridors, stairs, closets, storage, mechanical, electrical, and service rooms.
- include=false for title blocks, legends, exterior background, wall cavities, shafts that are not usable rooms, notes, dimensions, furniture, fixtures, or coloring mistakes.
- Judge the colored region as a whole. Do not trace polygons and do not change region ids.
- confidence is 0-1.`;
}

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
          get: (
            key: string,
          ) => { store_json?: string; value_json?: string } | undefined;
        };
        close: () => void;
      };
    };
    const db = new DatabaseSync(OPENCLAW_AUTH_DB, { readOnly: true });
    let storeJson: string | undefined;
    try {
      storeJson = db
        .prepare(
          "select value_json from config_machine_state where state_key = ?",
        )
        .get("authProfiles.store")?.value_json;
    } catch {
      storeJson = db
        .prepare(
          "select store_json from auth_profile_store where store_key = ?",
        )
        .get("primary")?.store_json;
    }
    db.close();
    return storeJson ? pickXaiAccess(storeJson) : null;
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
tables = {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
if "config_machine_state" in tables:
    row = con.execute("select value_json from config_machine_state where state_key='authProfiles.store'").fetchone()
else:
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
  const token = readXaiTokenFromNodeSqlite() ?? readXaiTokenFromPython();
  if (token) {
    console.log("[detect-ai] using OpenClaw xAI token, length", token.length);
  }
  return token;
}

function readVisionCredential() {
  return (
    process.env.XAI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    readXaiAccessToken()
  );
}

export function isVisionRoomDetectionConfigured() {
  return Boolean(readVisionCredential());
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

function imageMimeType(image: Buffer) {
  if (
    image.length >= 8 &&
    image[0] === 0x89 &&
    image[1] === 0x50 &&
    image[2] === 0x4e &&
    image[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    image.length >= 12 &&
    image.toString("ascii", 0, 4) === "RIFF" &&
    image.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

export function closestImagineAspectRatio(width: number, height: number) {
  const supported = [
    ["1:1", 1],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["2:1", 2],
    ["1:2", 1 / 2],
  ] as const;
  const target = width / Math.max(1, height);
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - target) < Math.abs(best[1] - target)
      ? candidate
      : best,
  )[0];
}

async function callVisionModel(images: Buffer | Buffer[], prompt: string) {
  const apiKey = readVisionCredential();
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

  const imageList = Array.isArray(images) ? images : [images];
  console.log(
    "[detect-ai] calling",
    model,
    "images",
    imageList.length,
    "bytes",
    imageList.reduce((total, image) => total + image.length, 0),
  );
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
            ...imageList.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${imageMimeType(image)};base64,${image.toString("base64")}`,
                detail: "high",
              },
            })),
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

async function callImagineRoomColoring(pageImage: Buffer) {
  const apiKey = process.env.XAI_API_KEY ?? readXaiAccessToken();
  if (!apiKey) {
    throw new Error("Grok Imagine room coloring is not configured");
  }
  const metadata = await sharp(pageImage).metadata();
  const model = process.env.XAI_IMAGINE_MODEL ?? "grok-imagine-image";
  const response = await fetch("https://api.x.ai/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: IMAGINE_ROOM_COLOR_PROMPT,
      n: 1,
      response_format: "b64_json",
      resolution: "2k",
      aspect_ratio: closestImagineAspectRatio(
        metadata.width ?? 4,
        metadata.height ?? 3,
      ),
      image: {
        type: "image_url",
        url: `data:${imageMimeType(pageImage)};base64,${pageImage.toString("base64")}`,
      },
    }),
    signal: AbortSignal.timeout(600_000),
  });
  const responseText = await response.text();
  let body: {
    error?: { message?: string };
    data?: Array<{ b64_json?: string }>;
  } = {};
  try {
    body = JSON.parse(responseText) as typeof body;
  } catch {
    if (!response.ok) {
      throw new Error(
        responseText.trim() || `Grok Imagine failed (${response.status})`,
      );
    }
    throw new Error("Grok Imagine returned an invalid response");
  }
  if (!response.ok) {
    throw new Error(
      body.error?.message ?? `Grok Imagine failed (${response.status})`,
    );
  }
  const encoded = body.data?.[0]?.b64_json;
  if (!encoded) throw new Error("Grok Imagine returned no colored page");
  console.log("[detect-ai] Imagine colored full page", model);
  return Buffer.from(encoded, "base64");
}

export async function detectRoomsFromPdfWithImagine(
  pdf: Buffer,
  pageNumber: number,
  onProgress: (message: string) => void = () => undefined,
): Promise<AiDetectedRoom[]> {
  onProgress("Rendering the complete PDF page for Grok Imagine");
  const source = await renderPdfRoomCrop(
    pdf,
    pageNumber,
    { x: 0, y: 0, w: 1, h: 1 },
    2048,
  );
  onProgress("Grok Imagine is coloring every room on the complete page");
  const colored = await callImagineRoomColoring(source.jpeg);
  onProgress("Extracting clickable regions from Imagine's colored page");
  const regions = await extractImagineRoomRegions(source.jpeg, colored);
  if (regions.length === 0) {
    throw new Error("Grok Imagine did not produce extractable room fills");
  }
  onProgress(`Imagine produced ${regions.length} colored regions`);

  // Imagine is fed a 2048px page, but printed suite tags are only a few pixels
  // tall at that width, so the naming pass reads a higher-resolution render of
  // the same framing instead.
  const naming = await renderPdfRoomCrop(
    pdf,
    pageNumber,
    { x: 0, y: 0, w: 1, h: 1 },
    NAMING_RENDER_WIDTH,
  );
  const [annotatedSource, annotated] = await Promise.all([
    annotateImagineRoomRegions(naming.jpeg, regions, { offsetRadii: 1.6 }),
    annotateImagineRoomRegions(colored, regions),
  ]);
  onProgress("Grok 4.6 is naming and auditing the colored regions");
  const audit = await callVisionModel(
    [annotatedSource, annotated],
    imagineRoomMappingPrompt(regions.map((region) => region.id)),
  );
  const assignments = parseImagineRoomAssignments(
    extractJsonObject(audit),
    new Set(regions.map((region) => region.id)),
  );
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  const rejected = assignments.filter((assignment) => !assignment.include).length;
  const unidentified = regions.filter((region) => !byId.has(region.id)).length;
  if (rejected > 0) onProgress(`Grok 4.6 rejected ${rejected} non-room regions`);
  if (unidentified > 0) {
    onProgress(
      `${unidentified} colored regions were unnamed and will remain editable generic rooms`,
    );
  }

  const nameCounts = new Map<string, number>();
  return regions.flatMap((region) => {
    const assignment = byId.get(region.id);
    if (assignment && !assignment.include) return [];
    const baseName = assignment?.name ?? `Room ${region.id}`;
    const count = (nameCounts.get(baseName.toLowerCase()) ?? 0) + 1;
    nameCounts.set(baseName.toLowerCase(), count);
    return [
      {
        name: count === 1 ? baseName : `${baseName} ${count}`,
        shape: region.shape,
      },
    ];
  });
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
  const hasLargeSuite = targets.some((target) => (target.areaSqFt ?? 0) > 500);
  const minHalf = hasLargeSuite ? 0.13 : 0.095;
  const halfW = Math.max(
    minHalf,
    (Math.max(...xs) - Math.min(...xs)) / 2 + 0.07,
  );
  const halfH = Math.max(
    minHalf,
    (Math.max(...ys) - Math.min(...ys)) / 2 + 0.07,
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
- Door openings and door-swing arcs never terminate a dwelling suite. Continue through internal doorways and include every face inside its exterior/demising walls.
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

function cropTouchesRoom(
  shape: RoomPolygonShape,
  crop: ReturnType<typeof expandDetectHint>,
) {
  const marginX = crop.w * 0.025;
  const marginY = crop.h * 0.025;
  return shape.points.some(
    (point) =>
      point.x <= crop.x + marginX ||
      point.x >= crop.x + crop.w - marginX ||
      point.y <= crop.y + marginY ||
      point.y >= crop.y + crop.h - marginY,
  );
}

function enlargeCrop(crop: ReturnType<typeof expandDetectHint>) {
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  const halfW = Math.min(0.28, crop.w * 0.8);
  const halfH = Math.min(0.28, crop.h * 0.8);
  const x = clamp01(cx - halfW);
  const y = clamp01(cy - halfH);
  const x2 = clamp01(cx + halfW);
  const y2 = clamp01(cy + halfH);
  return { x, y, w: x2 - x, h: y2 - y };
}

async function markRoomTarget(
  jpeg: Buffer,
  crop: ReturnType<typeof expandDetectHint>,
  point?: RoomPoint,
) {
  if (!point) return jpeg;
  const metadata = await sharp(jpeg).metadata();
  const width = metadata.width ?? 2048;
  const height = metadata.height ?? 2048;
  const x = ((point.x - crop.x) / crop.w) * width;
  const y = ((point.y - crop.y) / crop.h) * height;
  const radius = Math.max(14, Math.min(width, height) * 0.012);
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="none" stroke="#ef4444" stroke-width="6"/><path d="M ${(x - radius * 1.5).toFixed(1)} ${y.toFixed(1)} H ${(x + radius * 1.5).toFixed(1)} M ${x.toFixed(1)} ${(y - radius * 1.5).toFixed(1)} V ${(y + radius * 1.5).toFixed(1)}" stroke="#ef4444" stroke-width="4"/></svg>`,
  );
  return sharp(jpeg)
    .composite([{ input: svg }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function detectOneRoomFromPdfCrop(
  pdf: Buffer,
  pageNumber: number,
  hint: DetectRoomHint,
  crop: ReturnType<typeof expandDetectHint>,
) {
  const prepared = await renderPdfRoomCrop(pdf, pageNumber, crop, 2048);
  const marked = await markRoomTarget(prepared.jpeg, crop, hint.point);
  const content = await callVisionModel(marked, oneRoomPrompt(hint.name));
  return parseOneRoom(
    extractJsonObject(content),
    prepared.mapPoint,
    prepared.sentWidth,
    prepared.sentHeight,
    hint.name,
  );
}

/** Trace a labelled enclosure from a high-resolution crop of the source PDF. */
export async function detectOneRoomFromPdfPage(
  pdf: Buffer,
  pageNumber: number,
  hint: DetectRoomHint,
): Promise<AiDetectedRoom> {
  const initialCrop = expandDetectHint(hint);
  let room = await detectOneRoomFromPdfCrop(pdf, pageNumber, hint, initialCrop);
  const target = hint.point;
  const missedTarget = target && !pointInPolygon(target, room.shape);
  if (missedTarget || cropTouchesRoom(room.shape, initialCrop)) {
    const largerCrop = enlargeCrop(initialCrop);
    const retraced = await detectOneRoomFromPdfCrop(
      pdf,
      pageNumber,
      hint,
      largerCrop,
    );
    if (!target || pointInPolygon(target, retraced.shape)) {
      room = retraced;
    } else if (missedTarget) {
      throw new Error(
        `The traced boundary does not contain ${hint.name ?? "the target label"}`,
      );
    }
  }
  return room;
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

export async function detectLabelledRoomsFromPdf<
  T extends { name: string; x: number; y: number },
>(
  pdf: Buffer,
  pageNumber: number,
  targets: T[],
  onProgress: (message: string) => void = () => undefined,
): Promise<{ rooms: AiDetectedRoom[]; failed: T[] }> {
  const results = await mapPool(targets, 2, async (target, index) => {
    onProgress(`Tracing ${index + 1}/${targets.length}: ${target.name}`);
    try {
      const room = await detectOneRoomFromPdfPage(pdf, pageNumber, {
        name: target.name,
        point: { x: target.x, y: target.y },
      });
      return { target, room };
    } catch (error) {
      console.warn(
        "[detect-ai] labelled room trace failed",
        target.name,
        error instanceof Error ? error.message : error,
      );
      return { target, room: null };
    }
  });
  return {
    rooms: results.flatMap((result) => (result.room ? [result.room] : [])),
    failed: results.flatMap((result) => (result.room ? [] : [result.target])),
  };
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
