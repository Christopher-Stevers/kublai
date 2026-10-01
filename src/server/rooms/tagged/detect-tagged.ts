import { extractPdfLabels, extractPdfRoomSeeds } from "../pdf-walls";
import { physicalRoomSeeds } from "../physical-labels";
import { detectAllSpaces } from "../hybrid/all-spaces";
import { renderStructuralPage } from "./structural-render";
import { findRoomTagSeeds, mergeRoomSeeds } from "./room-tags";
import {
  heavyWallThreshold,
  keepWallsThickerThan,
  openSpaceMask,
  paintMask,
  strokeThicknessHistogram,
} from "./wall-weights";

export const TAGGED_VERSION = "tagged-units-v1";
const LONG_SIDE = 5000;
/** Door-width openings are closed so units separate from corridors. */
const DOOR_GAP_FACTOR = 1.15;

/**
 * Unit/suite-level room detection for construction floor plans:
 *  1. Room list from the drawing's own room tags (name above "A-118",
 *     "N221" above its type), plus plain room names without tags.
 *  2. Walls-only render: no text, no dashed lines, no screened-grey
 *     background linework, no coloured revision clouds.
 *  3. Courtyards/site/parking (regions far larger than the drawing's rooms)
 *     are blocked off.
 *  4. Only this drawing's heavy walls (demising, corridor, shaft, exterior)
 *     bound rooms, so a suite's interior partitions don't split it.
 *  5. Each seed claims its walled region; unclaimed enclosed areas are
 *     proposed as unlabelled spaces. Everything still needs review.
 */
export async function detectTaggedRooms(pdf: Buffer, pageNumber: number) {
  const labels = await extractPdfLabels(pdf, pageNumber);
  const page = await renderStructuralPage(pdf, pageNumber, LONG_SIDE);
  const { rgba, width, height } = page;
  const tagSeeds = findRoomTagSeeds(labels, width / height);
  const nameSeeds = physicalRoomSeeds(extractPdfRoomSeeds(labels));
  const seeds = mergeRoomSeeds(tagSeeds, nameSeeds);

  // Measure wall weights before anything is painted over the drawing.
  const heavy = heavyWallThreshold(strokeThicknessHistogram(rgba, width, height));
  const outdoor = openSpaceMask(rgba, width, height, seeds);
  paintMask(rgba, outdoor.mask);
  if (heavy) keepWallsThickerThan(rgba, width, height, heavy);

  const result = detectAllSpaces(rgba, width, height, seeds, true, DOOR_GAP_FACTOR);
  return {
    rooms: result.rooms.map((room) => ({
      ...room,
      detection: { ...room.detection, version: TAGGED_VERSION },
    })),
    unlabeledCount: result.unlabeledCount,
    rejectedSeeds: result.rejectedSeeds.map((r) => ({ ...r, name: seeds[r.seedIndex]?.name })),
    stats: {
      labels: labels.length,
      roomTags: tagSeeds.length,
      seeds: seeds.length,
      outdoorRegions: outdoor.regions,
      heavyWallPx: heavy,
    },
  };
}
