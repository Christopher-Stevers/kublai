"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  equipmentDrawingDestination,
  equipmentTagCandidates,
  equipmentTagLocations,
} from "~/lib/equipment-tags";
import { MAX_DRAWING_LINKS } from "~/lib/drawing-links";
import type {
  DrawingEntity,
  DrawingMarkupLink,
  DrawingSave,
} from "~/lib/drawing-workspace";
import type { DrawingText } from "~/lib/drawing-text";

export function AutoHyperlinkDialog(props: {
  sheetId: string;
  sourceId: string;
  jobId: string;
  setId: string;
  name: string;
  visibility: "private" | "published";
  entities: DrawingEntity[];
  readWords: () => Promise<DrawingText[]>;
  save: (value: DrawingSave) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const utils = api.useUtils();
  const [status, setStatus] = useState("Reading tags on this drawing…");
  const [notes, setNotes] = useState<string[]>([]);
  const [running, setRunning] = useState(true);
  const stopped = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    let active = true;
    stopped.current = false;
    const input = latest.current;
    const cancelled = () => !active || stopped.current;
    void (async () => {
      let linked = 0,
        skipped = 0,
        unmatched = 0;
      const issues: string[] = [];
      try {
        const words = await input.readWords();
        if (cancelled()) return;
        const tags = equipmentTagCandidates(words, [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]);
        if (!tags.length) {
          setStatus(
            "No readable equipment tags found. For scanned drawings, recognize text first, then try Auto Hyperlink again.",
          );
          return;
        }
        const { sources } =
          await utils.drawingsWorkspace.equipmentSources.fetch({
            sheetId: input.sheetId,
          });
        for (const [position, tag] of tags.entries()) {
          if (cancelled()) break;
          setStatus(`Matching ${tag} · ${position + 1} of ${tags.length} tags`);
          const existing = input.entities.some(
            (entity) =>
              entity.visibility !== "archived" &&
              entity.kind === "markup" &&
              entity.data.sourceSheetId === input.sourceId &&
              entity.data.equipmentTag === tag,
          );
          if (existing) {
            skipped++;
            continue;
          }
          const boxes = equipmentTagLocations(words, tag);
          if (!boxes.length) continue;
          const links: DrawingMarkupLink[] = [];
          let failed = false;
          // The first occurrence is the origin. Link the other occurrences on
          // this page too; the server creates their reciprocal clickable tags.
          for (const box of boxes.slice(1)) {
            const destination = equipmentDrawingDestination({
              jobId: input.jobId,
              setId: input.setId,
              sheetId: input.sheetId,
              sourceSheetId: input.sourceId,
              name: input.name,
              tag,
              box,
            });
            links.push({
              label: destination.title ?? tag,
              url: destination.href,
            });
          }
          for (let offset = 0; offset < sources.length; offset += 32) {
            if (cancelled()) break;
            try {
              const { results } =
                await utils.drawingsWorkspace.equipmentMatchesBatch.fetch(
                  {
                    sheetId: input.sheetId,
                    tag,
                    sources: sources.slice(offset, offset + 32),
                  },
                  { staleTime: 0 },
                );
              if (cancelled()) break;
              for (const result of results) {
                links.push(...result.links);
                issues.push(
                  ...result.warnings.map((note) => `${tag}: ${note}`),
                );
                if (result.overflow) {
                  failed = true;
                  issues.push(
                    `${tag}: too many occurrences in ${result.source.name}; link this tag manually.`,
                  );
                }
              }
            } catch (error) {
              failed = true;
              issues.push(
                `${tag}: ${error instanceof Error ? error.message : "Search failed"}. No links saved for this tag; retry after resolving the problem.`,
              );
              break;
            }
          }
          if (cancelled()) break;
          const unique = [
            ...new Map(
              links.map((link) => [link.url ?? link.targetSheetId, link]),
            ).values(),
          ];
          if (unique.length > MAX_DRAWING_LINKS) {
            failed = true;
            issues.push(
              `${tag}: more than ${MAX_DRAWING_LINKS} destinations; link this tag manually.`,
            );
          }
          if (failed) continue;
          if (!unique.length) {
            unmatched++;
            continue;
          }
          const box = boxes[0]!;
          try {
            await input.save({
              sheetId: input.sheetId,
              id: crypto.randomUUID(),
              kind: "markup",
              expectedRevision: 0,
              visibility: input.visibility,
              data: {
                sourceSheetId: input.sourceId,
                type: "link",
                equipmentTag: tag,
                points: [
                  { x: box.left, y: box.top },
                  { x: box.right, y: box.bottom },
                ],
                links: unique,
                linkAppearance: "highlight",
                stroke: "#facc15",
                width: 2,
                fill: "#facc15",
                opacity: 0.35,
              },
            });
            linked++;
          } catch (error) {
            issues.push(
              `${tag}: could not save — ${error instanceof Error ? error.message : "please retry"}`,
            );
          }
        }
        if (active)
          setStatus(
            `${stopped.current ? "Stopped" : "Finished"}. ${linked} tags linked, ${skipped} already linked, ${unmatched} without matches.`,
          );
      } catch (error) {
        if (active)
          setStatus(
            `Could not complete Auto Hyperlink: ${error instanceof Error ? error.message : "please reconnect and retry"}`,
          );
      } finally {
        if (active) {
          setNotes([...new Set(issues)]);
          setRunning(false);
        }
        if (linked) input.onSaved();
      }
    })();
    return () => {
      active = false;
    };
    // One scan per opening. Keep callbacks current without restarting the scan
    // when saving refreshes the workspace underneath this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sheetId, props.sourceId]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          stopped.current = true;
          props.onClose();
        }
      }}
    >
      <DialogContent layerClassName="z-[110]">
        <DialogHeader>
          <DialogTitle>Auto Hyperlink</DialogTitle>
          <DialogDescription>
            Find equipment tags on this sheet and link exact matches in this
            drawing set and the job’s documents. Existing tag links are kept.
          </DialogDescription>
        </DialogHeader>
        <p role="status" aria-live="polite">
          {status}
        </p>
        {notes.length > 0 && (
          <details>
            <summary>{notes.length} search notes</summary>
            <ul className="max-h-64 list-disc overflow-auto pl-5 text-sm">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        )}
        {running && (
          <p className="text-muted-foreground text-sm">
            You can stop the scan. Links already saved will remain.
          </p>
        )}
        <div className="flex justify-end">
          <Button
            variant={running ? "outline" : "default"}
            onClick={() => {
              if (running) {
                stopped.current = true;
                setStatus("Stopping after the current operation…");
              } else props.onClose();
            }}
          >
            {running ? "Stop" : "Done"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
