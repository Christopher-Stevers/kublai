import {
  parseNameKeywordGroups,
  type NameKeywordGroup,
} from "./material-list-sort";

export const NAME_KEYWORDS_KEY = "foremenhq.name-sort-keywords";
export const NAME_KEYWORDS_ROLLOUT_KEY = "foremenhq.name-sort-keywords-rollout";
export const NAME_KEYWORDS_ROLLOUT = "2026-09-22-shared-groups-v1";
export const SHARED_NAME_KEYWORD_GROUPS: readonly NameKeywordGroup[] = [
  { includes: "90", excludes: "Reducing, fitting, fit" },
  { includes: "45", excludes: "Reducing, fitting, fit, flange" },
  { includes: "Coupling", excludes: "Reducing, fitting, fit" },
  { includes: "Wye", excludes: "Reducing, fitting, fit" },
  { includes: "TY, tee", excludes: "" },
  { includes: "Adapter, adaptor", excludes: "Reducing, fitting, fit" },
  { includes: "Reducing", excludes: "" },
  { includes: "Fitting", excludes: "" },
  { includes: "Flange", excludes: "" },
];

/** Copy the requested groups once to every installation; retain subsequent edits. */
export function loadNameKeywordGroups(
  storage: Pick<Storage, "getItem" | "setItem">,
): readonly NameKeywordGroup[] {
  try {
    if (storage.getItem(NAME_KEYWORDS_ROLLOUT_KEY) !== NAME_KEYWORDS_ROLLOUT) {
      const previous = storage.getItem(NAME_KEYWORDS_KEY);
      if (previous !== null) {
        storage.setItem(
          `${NAME_KEYWORDS_KEY}.backup.${NAME_KEYWORDS_ROLLOUT}`,
          previous,
        );
      }
      storage.setItem(
        NAME_KEYWORDS_KEY,
        JSON.stringify(SHARED_NAME_KEYWORD_GROUPS),
      );
      storage.setItem(NAME_KEYWORDS_ROLLOUT_KEY, NAME_KEYWORDS_ROLLOUT);
      return SHARED_NAME_KEYWORD_GROUPS;
    }
    const saved = storage.getItem(NAME_KEYWORDS_KEY);
    return saved === null
      ? SHARED_NAME_KEYWORD_GROUPS
      : parseNameKeywordGroups(JSON.parse(saved));
  } catch {
    return SHARED_NAME_KEYWORD_GROUPS;
  }
}
