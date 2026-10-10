import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyDocumentTheme, THEME_BOOT_SCRIPT } from "./theme-document";
import { THEME_STORAGE_KEY } from "./theme";

const originalHead = document.head.innerHTML;
const meta = (name: string) =>
  document.querySelector<HTMLMetaElement>(`meta[name='${name}']`)!;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
  document.head.innerHTML =
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5"><meta name="theme-color" content="#111827">';
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
  localStorage.clear();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (Linux; Android 15) Chrome/146.0",
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  document.head.innerHTML = originalHead;
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Android browser theme", () => {
  it("paints a saved dark theme before hydration even when Android prefers light", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.eval(THEME_BOOT_SCRIPT);
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.style.backgroundColor).toBe(
      "rgb(10, 10, 10)",
    );
    expect(meta("theme-color").content).toBe("#0a0a0a");
    expect(meta("color-scheme").content).toBe("dark");
    expect(meta("viewport").content).toBe(
      "width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover",
    );
  });

  it("restores light browser colours and keeps zoom enabled when changing themes", () => {
    applyDocumentTheme(true);
    applyDocumentTheme(false);
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(meta("theme-color").content).toBe("#ffffff");
    expect(meta("color-scheme").content).toBe("light");
    expect(meta("viewport").content.match(/viewport-fit=/g)).toHaveLength(1);
    expect(meta("viewport").content).toContain("maximum-scale=5");
    expect(document.querySelectorAll('meta[name="color-scheme"]')).toHaveLength(
      1,
    );
  });

  it("uses the system preference when selected, and preserves the default for invalid storage", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    window.eval(THEME_BOOT_SCRIPT);
    expect(meta("color-scheme").content).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "invalid");
    window.eval(THEME_BOOT_SCRIPT);
    expect(meta("color-scheme").content).toBe("light");
  });

  it("still configures the browser when theme storage is unavailable", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    window.eval(THEME_BOOT_SCRIPT);
    expect(meta("viewport").content).toContain("viewport-fit=cover");
    expect(meta("color-scheme").content).toBe("light");
  });

  it("leaves the iPhone viewport unchanged while still applying its selected theme", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    );
    applyDocumentTheme(true);
    expect(meta("viewport").content).toBe(
      "width=device-width, initial-scale=1, maximum-scale=5",
    );
    expect(meta("color-scheme").content).toBe("dark");
  });

  it("replaces an existing viewport fit setting without accumulating duplicate values", () => {
    meta("viewport").content += ", viewport-fit=contain";
    applyDocumentTheme(true);
    applyDocumentTheme(true);
    expect(meta("viewport").content).not.toContain("viewport-fit=contain");
    expect(meta("viewport").content.match(/viewport-fit=/g)).toHaveLength(1);
  });
});
