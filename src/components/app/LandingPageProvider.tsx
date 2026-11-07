"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, XIcon } from "lucide-react";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import type { SnapshotSource } from "~/lib/snapshot-source";
import { Button } from "~/components/ui/button";
import { DefaultLandingPageContext, useLandingPage } from "~/hooks/use-landing-page";

const Context = createContext<{ start: () => void; active: boolean } | null>(null);
export const useLandingPagePicker = () => useContext(Context);
export function LandingPageProvider({ userId, initial, children }: { userId: string; initial?: SnapshotSource | null; children: React.ReactNode }) {
  const registry = useContext(SnapshotSourceContext);
  const { setLandingPage } = useLandingPage(userId, initial);
  const key = `foremenhq:landing-picker:${userId}`;
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    try { setActive(sessionStorage.getItem(key) === "true"); } catch { /* Session-only fallback. */ }
  }, [key]);
  useEffect(() => {
    const refresh = () => setHost(document.fullscreenElement ?? document.querySelector('[data-drawing-fullscreen="true"]') ?? document.body);
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-drawing-fullscreen"] });
    document.addEventListener("fullscreenchange", refresh);
    return () => { observer.disconnect(); document.removeEventListener("fullscreenchange", refresh); };
  }, []);
  const picking = (next: boolean) => {
    setActive(next); setError("");
    try { if (next) sessionStorage.setItem(key, "true"); else sessionStorage.removeItem(key); } catch { /* Keep picker working in this session. */ }
  };
  const save = () => {
    try {
      if (!registry) throw Error("This page is not ready. Try again.");
      const source = registry.captureSource();
      if (!setLandingPage(source)) throw Error("Could not save the destination on this device.");
      picking(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save destination."); }
  };
  return <DefaultLandingPageContext.Provider value={initial ?? null}><Context.Provider value={{ start: () => picking(true), active }}>
    {children}
    {active && host && createPortal(<div data-snapshot-ui className="fixed right-5 z-[250] flex max-w-xs flex-col items-end gap-2" style={{ bottom: "calc(10rem + env(safe-area-inset-bottom))" }}>
      <p className="bg-background text-foreground rounded-md border px-3 py-2 text-sm shadow-lg" role="status">{error || "Navigate to your landing page, then tap the checkmark."}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="icon" aria-label="Cancel landing page selection" onClick={() => picking(false)}><XIcon /></Button>
        <Button className="size-14 rounded-full shadow-lg" aria-label="Save current page as landing page" onClick={save}><CheckIcon className="size-7" /></Button>
      </div>
    </div>, host)}
  </Context.Provider></DefaultLandingPageContext.Provider>;
}
