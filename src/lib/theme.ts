export const THEME_STORAGE_KEY = "foremenhq-theme";

// Tim requested this one-time reset on 2026-10-10. Keep the marker stable so
// later releases and reloads preserve choices made after the reset.
export const THEME_SYSTEM_RESET_KEY = "foremenhq-theme-system-reset-20261010";

export const THEME_OPTIONS = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number];

/** Used until someone picks a theme in Settings. */
export const DEFAULT_THEME: ThemePreference = "light";

// Self-contained for use by both the pre-paint script and React. Arguments
// avoid module references when this function is embedded in the early script.
export function readThemePreference(
  storageKey = THEME_STORAGE_KEY,
  resetKey = THEME_SYSTEM_RESET_KEY,
  fallback: ThemePreference = DEFAULT_THEME,
): ThemePreference {
  try {
    if (localStorage.getItem(resetKey) !== "done") {
      localStorage.setItem(storageKey, "system");
      localStorage.setItem(resetKey, "done");
      return "system";
    }
    const stored = localStorage.getItem(storageKey);
    return stored === "dark" || stored === "light" || stored === "system"
      ? stored
      : fallback;
  } catch {
    return "system";
  }
}
