export const THEME_STORAGE_KEY = "foremenhq-theme";

export const THEME_OPTIONS = ["system", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number];

/** Used until someone picks a theme in Settings. */
export const DEFAULT_THEME: ThemePreference = "light";

export function isThemePreference(
  value: string | null,
): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}
