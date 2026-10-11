import { z } from "zod";
import type { BimModel, BimViewState } from "./types";

export const nativeRevitReportSchema = z.object({
  schemaVersion: z.literal(1),
  engine: z.literal("foreman-native-revit"),
  engineVersion: z.string().max(40),
  readerRevision: z.string().regex(/^[a-f0-9]{40}$/),
  revitVersion: z.number().int().min(2000).max(2100).nullable(),
  outcome: z.enum(["preview", "unsupported"]),
  coordinates: z.literal("revit-internal"),
  measurementsAllowed: z.literal(false),
  decodedElements: z.number().int().nonnegative().max(1000000),
  displayedElements: z.number().int().nonnegative().max(1000000),
  omittedBoxElements: z.number().int().nonnegative().max(1000000),
  savedMeshElements: z.number().int().nonnegative().max(1000000),
  levels: z.number().int().nonnegative().max(100000),
  categories: z.record(z.string().max(100), z.number().int().nonnegative()),
  warnings: z.array(z.string().max(1000)).max(20),
});
export type NativeRevitReport = z.infer<typeof nativeRevitReportSchema>;
export const isNativeRevitPreview = (model: BimModel) =>
  model.conversionEngine === "native" || Boolean(model.nativeConversion);

/** Shared client/server policy until geometry and shared coordinates are verified. */
export function nativeViewRestriction(
  models: BimModel[],
  view: Pick<BimViewState, "modelIds" | "measurements">,
): string | null {
  if (!models.some(isNativeRevitPreview)) return null;
  if (view.modelIds.length > 1)
    return "Open a native Revit preview on its own; shared coordinates are not verified yet.";
  if (view.measurements.length)
    return "Measurements are unavailable for experimental Revit previews. Use a verified IFC export for dimensions.";
  return null;
}
