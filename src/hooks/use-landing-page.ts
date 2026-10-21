"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { snapshotSourceSchema, type SnapshotSource } from "~/lib/snapshot-source";
import { landingPageDestination } from "~/lib/landing-page-destination";
export const DefaultLandingPageContext = createContext<SnapshotSource | null>(null);
const EVENT = "foremenhq:landing-page";

/** Account-specific destination on this device; captures use the hyperlink format. */
export function useLandingPage(userId?: string, initial?: SnapshotSource | null) {
  const inherited = useContext(DefaultLandingPageContext);
  const fallback = initial ?? inherited;
  const key = userId ? `foremenhq.landing-page.${userId}` : null;
  const [saved, setSaved] = useState<{ key: string | null; source: SnapshotSource | null }>({ key: null, source: null });
  useEffect(() => {
    const read = () => {
      let source: SnapshotSource | null = null;
      try {
        const parsed = snapshotSourceSchema.safeParse(JSON.parse(key ? localStorage.getItem(key) ?? "null" : "null"));
        if (parsed.success) source = parsed.data;
      } catch { /* Storage may be unavailable. */ }
      setSaved({ key, source });
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener(EVENT, read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener(EVENT, read);
    };
  }, [key]);
  const setLandingPage = (source: SnapshotSource | null) => {
    if (!key || (source && !snapshotSourceSchema.safeParse(source).success)) return false;
    try {
      if (source) localStorage.setItem(key, JSON.stringify(source));
      else localStorage.removeItem(key);
      setSaved({ key, source });
      window.dispatchEvent(new Event(EVENT));
      return true;
    } catch { return false; }
  };
  const source = (saved.key === key ? saved.source : null) ?? fallback;
  return { landingPage: landingPageDestination(source), source, setLandingPage };
}
