"use client";
import { setPageWindowMode, usePageWindowMode, type PageWindowMode } from "~/lib/page-window-mode";
export function PageWindowSettings() {
  const mobile = usePageWindowMode("mobile"), desktop = usePageWindowMode("desktop");
  return <div className="space-y-3 border-t pt-4">
    <p className="text-sm font-medium">Open new pages</p>
    {(["mobile", "desktop"] as const).map(device => <label key={device} className="flex items-center justify-between gap-3 text-sm">
      <span>{device === "mobile" ? "Mobile" : "Desktop"}</span>
      <select className="bg-background rounded-md border px-3 py-2" value={device === "mobile" ? mobile : desktop} onChange={event => setPageWindowMode(device, event.target.value as PageWindowMode)}>
        <option value="internal">Inside ForemanHQ</option>
        <option value="external">Separate window</option>
      </select>
    </label>)}
    <p className="text-muted-foreground text-sm">Hidden internal pages pause until you return. Your place and drafts stay open; uploads, saves and server jobs continue. Changes apply to new pages.</p>
  </div>;
}
