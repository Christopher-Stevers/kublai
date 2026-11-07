import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEME_SYSTEM_RESET_KEY,
  readThemePreference,
} from "./theme";

/** Keep page colours and browser chrome in sync, including before React loads. */
export function applyDocumentTheme(dark: boolean) {
  const root = document.documentElement;
  const scheme = dark ? "dark" : "light";
  const background = dark ? "#0a0a0a" : "#ffffff";
  root.classList.toggle("dark", dark);
  root.style.colorScheme = scheme;
  // Paint the root before CSS arrives, and behind Android's gesture area.
  root.style.backgroundColor = background;
  for (const [name, content] of [
    ["theme-color", background],
    ["color-scheme", scheme],
  ] as const) {
    let meta = document.querySelector<HTMLMetaElement>(`meta[name='${name}']`);
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = name;
      document.head.append(meta);
    }
    meta.content = content;
  }

  // Chrome's edge-to-edge opt-in lets the page paint the bottom system area.
  // Existing bottom bars already pad their controls with safe-area insets.
  // Restrict this opt-in to Android; iOS's notch layout is handled separately.
  if (/Android/i.test(navigator.userAgent)) {
    const viewport = document.querySelector<HTMLMetaElement>(
      "meta[name='viewport']",
    );
    if (viewport) {
      const settings = viewport.content
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value && !/^viewport-fit\s*=/i.test(value));
      const content = [...settings, "viewport-fit=cover"].join(", ");
      if (viewport.content !== content) viewport.content = content;
    }
  }
}

// The function is self-contained so the early script and React use the same
// browser settings. Storage failures must not prevent painting the page.
export const THEME_BOOT_SCRIPT = `
(() => {
  const theme = (${readThemePreference.toString()})(
    ${JSON.stringify(THEME_STORAGE_KEY)},
    ${JSON.stringify(THEME_SYSTEM_RESET_KEY)},
    ${JSON.stringify(DEFAULT_THEME)}
  );
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  (${applyDocumentTheme.toString()})(theme === "dark" || (theme === "system" && prefersDark));
})();
`;
