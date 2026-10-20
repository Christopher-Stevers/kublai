import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readDrawingPipeLinework } from "~/server/drawings/pipe-linework";
import { extractPdfLabels, extractPdfRoomSeeds } from "../pdf-walls";
import { physicalRoomSeeds } from "../physical-labels";
import { SERVER_PDF_RENDER_OPTIONS } from "../pdf-render-options";
import { findRoomTagSeeds } from "../tagged/room-tags";
import { outlineRooms } from "../tagged/outline";
import { detectDoorRooms, hasDoorLayers, unitTagSeeds } from "./door-rooms";
import type { LayeredSegment } from "./door-graph";
import { inferPlanLayers } from "./infer-layers";

export const DOOR_ROOMS_VERSION = "door-units-v1";
const LONG_SIDE = 5000;
const unzip = promisify(gunzip);

type Linework = { segments: LayeredSegment[]; aspect: number };

/** The page's strokes with layer names: the copy saved at upload, else read from the PDF. */
async function loadLinework(pdf: Buffer, pageNumber: number, cached?: () => Promise<Buffer>) {
  const saved = await cached?.()
    .then(async (file) => (JSON.parse((await unzip(file)).toString()) as { linework: Linework }).linework)
    .catch(() => null);
  if (saved?.segments?.length) return saved;
  const task = getDocument({
    ...SERVER_PDF_RENDER_OPTIONS,
    verbosity: VerbosityLevel.ERRORS,
    data: new Uint8Array(pdf),
  });
  const document = await task.promise;
  try {
    return await readDrawingPipeLinework(document, await document.getPage(pageNumber));
  } finally {
    await task.destroy();
  }
}

/**
 * Rooms from a CAD export that kept its layers (A-WALL, A-DOOR…). Walls and
 * door swings enclose spaces; spaces many doors open into are the common
 * spaces (corridors, lobbies); each unit is what lies behind a door off them.
 * Returns null when the page has no usable wall/door layers or too few doors
 * to read, so the caller can fall back to the image-based detectors.
 */
export async function detectLayeredRooms(
  pdf: Buffer,
  pageNumber: number,
  cached?: () => Promise<Buffer>,
) {
  const linework = await loadLinework(pdf, pageNumber, cached);
  if (!linework.segments?.length) return null;
  const aspect = linework.aspect > 0 ? linework.aspect : 1;
  // A flattened print has no layers; read walls and doors from pen weights
  // and door swings instead.
  let segments = linework.segments;
  if (!hasDoorLayers(segments)) {
    const inferred = inferPlanLayers(segments, aspect);
    if (!inferred || !hasDoorLayers(inferred.segments)) return null;
    segments = inferred.segments;
  }
  const width = Math.round(aspect > 1 ? LONG_SIDE / aspect : LONG_SIDE);
  const height = Math.round(aspect > 1 ? LONG_SIDE : LONG_SIDE * aspect);
  const labels = await extractPdfLabels(pdf, pageNumber);
  // Priority: suite tags ("N221 MICRO"), plain room names, then numbered room tags.
  const seeds = [
    ...unitTagSeeds(labels, width / height),
    ...physicalRoomSeeds(extractPdfRoomSeeds(labels)),
    ...findRoomTagSeeds(labels, width / height),
  ];
  const result = detectDoorRooms(segments, { width, height, seeds });
  const common = result.rooms.filter((r) => r.kind === "common").length;
  if (result.links < 8 || !common) return null;

  // outlineRooms names labels 1..k from its seed list; give named rooms the
  // low labels and unnamed common spaces a generic name.
  const order = result.rooms.map((room, i) => ({ room, from: i + 1 }))
    .sort((a, b) => Number(!a.room.name) - Number(!b.room.name));
  const remap = new Int32Array(result.rooms.length + 1);
  order.forEach(({ from }, i) => { remap[from] = i + 1; });
  for (let p = 0; p < result.labels.length; p++) result.labels[p] = remap[result.labels[p]!]!;
  const named = order.filter(({ room }) => room.name).map(({ room }) => ({ name: room.name! }));
  const renames = new Map<number, string>();
  let shared = 0;
  order.forEach(({ room }, i) => {
    if (!room.name && room.kind === "common") renames.set(i + 1, `Common area ${++shared}`);
  });
  const rooms = outlineRooms(result.labels, width, height, named, DOOR_ROOMS_VERSION, renames);
  return {
    rooms,
    unlabeledCount: rooms.filter((r) => r.detection.basis === "walls-without-label").length,
    stats: {
      doors: result.links,
      sealedSwings: result.sealed,
      spaces: result.spaces,
      commonSpaces: common,
      units: result.rooms.length - common,
    },
  };
}
