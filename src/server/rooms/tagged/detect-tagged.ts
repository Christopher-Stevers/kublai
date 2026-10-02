import { extractPdfLabels, extractPdfRoomSeeds } from "../pdf-walls";
import { physicalRoomSeeds } from "../physical-labels";
import { renderStructuralPage } from "./structural-render";
import { findRoomTagSeeds, mergeRoomSeeds } from "./room-tags";
import {
  keepDoubleLineWalls,
  openSpaceMask,
  paintMask,
} from "./wall-weights";
import { partitionAtNecks } from "./neck-partition";
import { outlineRooms } from "./outline";

export const TAGGED_VERSION = "tagged-units-v2";
const LONG_SIDE = 5000;
/** Spaces narrower than 2× this (doorways, cased openings) separate rooms. */
const NECK_FRACTION = 0.003;

/**
 * Unit/suite-level room detection for construction floor plans:
 *  1. Room list from the drawing's own room tags (name above "A-118",
 *     "N221" above its type), plus plain room names without tags.
 *  2. Walls-only render: no text, no dashed lines, no screened-grey
 *     background linework, no coloured revision clouds; then only double-line
 *     or solid walls (door swings, fixtures and furniture are single lines).
 *  3. Courtyards/site/parking (regions far larger than the drawing's rooms)
 *     are blocked off.
 *  4. Free space is split at doorways (narrow necks), each room seed names
 *     its space, and the rooms of a suite are joined through its private
 *     doorways. Corridors and lobbies shared by several rooms stay separate.
 * Everything still needs review.
 */
export async function detectTaggedRooms(pdf: Buffer, pageNumber: number) {
  const labels = await extractPdfLabels(pdf, pageNumber);
  const page = await renderStructuralPage(pdf, pageNumber, LONG_SIDE);
  const { rgba, width, height } = page;
  const tagSeeds = findRoomTagSeeds(labels, width / height);
  const nameSeeds = physicalRoomSeeds(extractPdfRoomSeeds(labels));
  const seeds = mergeRoomSeeds(tagSeeds, nameSeeds);

  const outdoor = openSpaceMask(rgba, width, height, seeds);
  paintMask(rgba, outdoor.mask);
  keepDoubleLineWalls(rgba, width, height);
  const walls = new Uint8Array(width * height);
  for (let i = 0; i < walls.length; i++) walls[i] = rgba[i * 4]! < 128 ? 1 : 0;

  const neck = Math.round(Math.max(width, height) * NECK_FRACTION);
  const result = partitionAtNecks(walls, width, height, seeds, { neck, minRoomPx: (neck * 2) ** 2 });
  const rooms = outlineRooms(result.labels, width, height, seeds, TAGGED_VERSION, result.renames);
  return {
    rooms,
    unlabeledCount: rooms.filter((r) => r.detection.basis === "walls-without-label").length,
    rejectedSeeds: result.rejected.map((r) => ({ ...r, name: seeds[r.seedIndex]?.name })),
    stats: {
      labels: labels.length,
      roomTags: tagSeeds.length,
      seeds: seeds.length,
      outdoorRegions: outdoor.regions,
      spaces: result.cores,
      joinedIntoUnits: result.merged,
    },
  };
}
