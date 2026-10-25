import { z } from "zod";
import { SHARED_NAME_KEYWORD_GROUPS } from "./name-keyword-defaults";
export const materialSortSettingsSchema = z.object({
  sortMode: z.enum(["material", "supplier", "recent"]),
  keywordGroups: z
    .array(
      z.object({
        includes: z.string().max(2000),
        excludes: z.string().max(2000),
      }),
    )
    .max(100),
});
export type MaterialSortSettings = z.infer<typeof materialSortSettingsSchema>;
export const defaultMaterialSortSettings: MaterialSortSettings = {
  sortMode: "material",
  keywordGroups: [...SHARED_NAME_KEYWORD_GROUPS],
};
export function effectiveMaterialSortSettings(
  shared: MaterialSortSettings,
  personal: MaterialSortSettings | null,
  custom: boolean,
) {
  return custom && personal ? personal : shared;
}
