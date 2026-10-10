"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isThemePreference,
  type ThemePreference,
} from "~/lib/theme";
import { applyDocumentTheme } from "~/lib/theme-document";

type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(storedTheme) ? storedTheme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function getSystemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: ThemePreference) {
  const shouldUseDark =
    theme === "dark" || (theme === "system" && getSystemPrefersDark());
  applyDocumentTheme(shouldUseDark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(DEFAULT_THEME);

  useEffect(() => {
    const storedTheme = getStoredTheme();
    setThemeState(storedTheme);
    applyTheme(storedTheme);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (getStoredTheme() === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
    };
  }, []);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setThemeState(nextTheme);
    applyTheme(nextTheme);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useThemePreference() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useThemePreference must be used inside ThemeProvider");
  }
  return context;
}
