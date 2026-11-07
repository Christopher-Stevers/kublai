"use client";
import { useEffect, useState } from "react";
import type { DrawingOfflineStore } from "~/lib/drawing-offline";
import type { DrawingWorkspace } from "~/lib/drawing-workspace";
import { sourcePdfPage } from "~/lib/pdf-client";

/** All sheet surfaces recognize the same retained files, including old folder downloads. */
export function useSheetOfflineStatus(
  store: DrawingOfflineStore | null | undefined,
  sheet: { id: string; imageUrl: string },
  workspaceSheetId = sheet.id,
) {
  const [saved, setSaved] = useState(false);
  const marker = `sheet-download:${sheet.id}:${sheet.imageUrl}`;
  useEffect(() => {
    let active = true;
    setSaved(false);
    let check = 0;
    const refresh = async () => {
      const generation = ++check;
      let available = false;
      try {
        if (!store) return;
        let urls = await store.readSnapshot<string[]>(marker);
        if (!urls?.length) {
          // Folder downloads predate individual completion markers. Recognize
          // their actual assets and workspace without downloading them again.
          const workspace = await store.readSnapshot<DrawingWorkspace>(
            `workspace:${workspaceSheetId}`,
          );
          const current = workspace?.jobSheets?.find(
            (source) => source.id === workspace.metadata.currentSourceSheetId,
          );
          if (
            !current ||
            !workspace?.jobSheets.some(
              (source) => source.imageUrl === sheet.imageUrl,
            )
          )
            return;
          urls = [
            ...new Set(
              [sheet.imageUrl, current.imageUrl].flatMap((image) => {
                const pdf = sourcePdfPage(image);
                return pdf ? [image, pdf.url] : [image];
              }),
            ),
          ];
        }
        for (const url of urls) if (!(await store.readAsset(url))) return;
        available = true;
      } finally {
        if (active && generation === check) setSaved(available);
      }
    };
    const changed = () => {
      void refresh().catch(() => undefined);
    };
    changed();
    window.addEventListener("foremanhq-drawing-downloads-changed", changed);
    return () => {
      active = false;
      window.removeEventListener(
        "foremanhq-drawing-downloads-changed",
        changed,
      );
    };
  }, [store, marker, workspaceSheetId, sheet.imageUrl]);
  return { saved, setSaved };
}
