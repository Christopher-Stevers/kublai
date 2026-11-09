"use client";
import { DEFAULT_HYPERLINK_COLOR, DEFAULT_HYPERLINK_OPACITY } from "~/lib/drawing-hyperlink-style";
import { drawingTagCandidates, drawingTagLocations } from "~/lib/drawing-tags";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  equipmentDrawingDestination,
} from "~/lib/equipment-tags";
import { MAX_DRAWING_LINKS } from "~/lib/drawing-links";
import type {
  DrawingEntity,
  DrawingMarkupLink,
  DrawingSave,
} from "~/lib/drawing-workspace";
import type { DrawingText } from "~/lib/drawing-text";
import {
  hyperlinkReaderLabels,
  hyperlinkReaders,
  type HyperlinkReader,
} from "~/lib/hyperlink-readers";

import type { HyperlinkScope } from "~/lib/hyperlink-scope";
import { HyperlinkScopePicker } from "./HyperlinkScopePicker";

type Match = {
  tag: string;
  links: DrawingMarkupLink[];
  box: DrawingText;
  boxes: DrawingText[];
  needsPositionReview: boolean;
  occurrences: number;
  existing: boolean;
  selected: boolean;
  overflow: boolean;
  saved?: boolean;
  error?: string;
};
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
  const detect = api.drawingsWorkspace.autoHyperlinkDetect.useMutation({
    retry: false,
  });
  const [highlightColor, setHighlightColor] = useState(DEFAULT_HYPERLINK_COLOR);
  const [reader, setReader] = useState<HyperlinkReader>("normal");
  const [hasReading, setHasReading] = useState(false);
  const [readers, setReaders] = useState<{
    terra: { available: boolean };
  } | null>(null);
  const [readerError, setReaderError] = useState("");
  const [scope, setScope] = useState<HyperlinkScope>({
    scope: "job",
    drawingIds: [],
    documentIds: [],
  });
  const [rows, setRows] = useState<Match[]>([]),
    [notes, setNotes] = useState<string[]>([]);
  const [status, setStatus] = useState("Reading drawing tags…"),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(0),
    [search, setSearch] = useState("");
  const run = useRef(0),
    initial = useRef<() => void>(() => undefined);
  const checkReaders = useCallback(async () => {
    try {
      setReaders(
        await utils.drawingsWorkspace.autoHyperlinkReaders.fetch(
          { sheetId: props.sheetId },
          { staleTime: 0 },
        ),
      );
      setReaderError("");
    } catch {
      setReaderError(
        "Could not check AI reader connections. Normal is available.",
      );
    }
  }, [props.sheetId, utils]);
  useEffect(() => {
    void checkReaders();
  }, [checkReaders]);
  const emptyScope =
    scope.scope === "custom" &&
    !scope.drawingIds.length &&
    !scope.documentIds.length;
  async function scan(refresh = false) {
    if (emptyScope) {
      setStatus("Choose at least one sheet or document to search.");
      return;
    }
    const id = ++run.current;
    setBusy(true);
    setRows([]);
    setNotes([]);
    setPending(0);
    setStatus("Reading drawing tags…");
    try {
      const located = new Map<
        string,
        { boxes: DrawingText[]; needsPositionReview: boolean }
      >();
      const warnings = new Set<string>();
      if (reader === "normal") {
        const words = await props.readWords();
        if (id !== run.current) return;
        if (!words.length) {
          setStatus(
            "No readable text found. Use Recognize text on this drawing, then scan again, or choose an AI version.",
          );
          return;
        }
        setStatus("Checking job drawings and indexing destinations…");
        const vocabulary =
          await utils.drawingsWorkspace.autoHyperlinkSources.fetch(
            { sheetId: props.sheetId },
            { staleTime: 0 },
          );
        if (id !== run.current) return;
        vocabulary.warnings.forEach((w) => warnings.add(w));
        for (const tag of drawingTagCandidates(words, vocabulary))
          located.set(tag, {
            boxes: drawingTagLocations(words, tag),
            needsPositionReview: false,
          });
      } else {
        setStatus(
          "Terra is reading the drawing image…",
        );
        const detection = await detect.mutateAsync({
          sheetId: props.sheetId,
          sourceSheetId: props.sourceId,
          reader,
          requestId: crypto.randomUUID(),
          refresh,
        });
        if (id !== run.current) return;
        setHasReading(true);
        detection.warnings.forEach((w) => warnings.add(w));
        if (detection.cached)
          warnings.add(
            "Reused the saved reading for this drawing. Read again requests a new reading.",
          );
        for (const tag of detection.tags) located.set(tag.tag, tag);
      }
      const tags = [...located.keys()];
      if (!tags.length) {
        setNotes([...warnings]);
        setStatus(
          "No drawing tags identified. Use Tools → Hyperlink to link a custom tag.",
        );
        return;
      }
      const results: Match[] = [];
      let indexing = 0;
      for (let start = 0; start < tags.length; start += 200) {
        setStatus(
          `Matching ${start + 1}–${Math.min(start + 200, tags.length)} of ${tags.length} tags…`,
        );
        const result = await utils.drawingsWorkspace.autoHyperlinkPreview.fetch(
          {
            sheetId: props.sheetId,
            tags: tags.slice(start, start + 200),
            ...scope,
          },
          { staleTime: 0 },
        );
        if (id !== run.current) return;
        indexing = Math.max(indexing, result.pending);
        result.warnings.forEach((w) => warnings.add(w));
        for (const match of result.results) {
          const detection = located.get(match.tag);
          const boxes = detection?.boxes ?? [],
            box = boxes[0];
          if (!box) continue;
          const links: DrawingMarkupLink[] = [...match.links];
          if (
            boxes[1] &&
            scope.scope !== "documents" &&
            (scope.scope !== "custom" ||
              scope.drawingIds.includes(props.sheetId))
          ) {
            const d = equipmentDrawingDestination({
              jobId: props.jobId,
              setId: props.setId,
              sheetId: props.sheetId,
              sourceSheetId: props.sourceId,
              name: props.name,
              tag: match.tag,
              box: boxes[1],
            });
            links.unshift({ label: d.title ?? match.tag, url: d.href });
          }
          const unique = [...new Map(links.map((l) => [l.url, l])).values()];
          const existing = props.entities.some(
            (e) =>
              e.visibility !== "archived" &&
              e.kind === "markup" &&
              e.data.sourceSheetId === props.sourceId &&
              e.data.equipmentTag === match.tag,
          );
          const overflow = match.overflow || unique.length > MAX_DRAWING_LINKS;
          results.push({
            tag: match.tag,
            box,
            boxes,
            needsPositionReview: detection?.needsPositionReview ?? false,
            links: unique,
            occurrences: boxes.length,
            existing,
            selected:
              reader === "normal" &&
              !/^(?:[A-Z]{1,3}|\d+[A-Z]?)$/.test(match.tag) &&
              !existing &&
              !overflow &&
              unique.length > 0,
            overflow,
          });
        }
      }
      setRows(results);
      setNotes([...warnings]);
      setPending(indexing);
      setStatus(
        `${results.length} tags reviewed · ${results.filter((r) => !r.links.length).length} without destinations · ${results.filter((r) => r.existing).length} already linked`,
      );
    } catch (e) {
      if (id === run.current)
        setStatus(e instanceof Error ? e.message : "Scan failed. Try again.");
    } finally {
      if (id === run.current) setBusy(false);
    }
  }
  initial.current = () => void scan();
  useEffect(() => {
    const counter = run;
    initial.current();
    return () => {
      counter.current++;
    };
  }, []);
  async function saveSelected() {
    const id = ++run.current;
    setBusy(true);
    let saved = 0;
    try {
      for (const row of rows.filter(
        (r) =>
          r.selected &&
          !r.existing &&
          !r.saved &&
          !r.overflow &&
          r.links.length,
      )) {
        if (id !== run.current) break;
        setStatus(`Saving ${row.tag}…`);
        try {
          await props.save({
            sheetId: props.sheetId,
            id: crypto.randomUUID(),
            kind: "markup",
            expectedRevision: 0,
            visibility: props.visibility,
            data: {
              sourceSheetId: props.sourceId,
              type: "link",
              equipmentTag: row.tag,
              hyperlinkReader: reader,
              ...(reader !== "normal"
                ? {
                    equipmentTagBoxes: row.boxes.map(
                      ({ left, top, right, bottom }) => ({
                        left,
                        top,
                        right,
                        bottom,
                      }),
                    ),
                  }
                : {}),
              points: [
                { x: row.box.left, y: row.box.top },
                { x: row.box.right, y: row.box.bottom },
              ],
              links: row.links,
              linkAppearance: "highlight",
              stroke: highlightColor,
              width: 2,
              fill: highlightColor,
              opacity: DEFAULT_HYPERLINK_OPACITY,
            },
          });
          saved++;
          setRows((current) =>
            current.map((r) =>
              r.tag === row.tag
                ? { ...r, saved: true, selected: false, error: undefined }
                : r,
            ),
          );
        } catch (e) {
          if (id === run.current)
            setRows((current) =>
              current.map((r) =>
                r.tag === row.tag
                  ? {
                      ...r,
                      error:
                        e instanceof Error ? e.message : "Save failed; retry.",
                    }
                  : r,
              ),
            );
        }
      }
      if (id === run.current)
        setStatus(
          `${saved} tags linked. Failed items remain selected so you can retry.`,
        );
    } finally {
      if (saved) props.onSaved();
      if (id === run.current) setBusy(false);
    }
  }
  const eligible = (r: Match) =>
    !r.existing && !r.saved && !r.overflow && r.links.length > 0;
  const visible = rows.filter((r) =>
    `${r.tag} ${r.links.map((l) => l.label).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          run.current++;
          props.onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Auto Hyperlink</DialogTitle>
          <DialogDescription>
            Find equipment, rooms, doors, notes, drawing references and other tags across current drawings and job documents. Review
            destinations, then save links at every occurrence of the selected
            tags.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1 text-sm">
          Highlight colour
          <input type="color" aria-label="Hyperlink highlight colour" className="h-10 w-full" value={highlightColor} disabled={pending > 0} onChange={event => setHighlightColor(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Version
          <select
            aria-label="Auto Hyperlink version"
            className="bg-background h-11 w-full rounded border px-2"
            value={reader}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value as HyperlinkReader;
              run.current++;
              setReader(next);
              setHasReading(false);
              setRows([]);
              setNotes([]);
              setPending(0);
              setStatus(
                next === "normal"
                  ? "Scan with the normal flow."
                  : "Start a reading, review tag locations and destinations, then select the links to save.",
              );
            }}
          >
            {hyperlinkReaders.map((value) => (
              <option key={value} value={value}>
                {hyperlinkReaderLabels[value]}
              </option>
            ))}
          </select>
        </label>
        {reader !== "normal" && (
          <p className="text-muted-foreground text-sm">
            {readers?.[reader].available
              ? "Reads tags from this drawing’s image. Check locations and select the links you want to save."
              : readers
                ? "Terra is not connected yet. Ask your administrator to connect it."
                : "Checking reader connection…"}
          </p>
        )}
        {readerError && (
          <p role="alert" className="text-sm">
            {readerError}
          </p>
        )}
        {reader !== "normal" && !readers?.[reader].available && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void checkReaders()}
          >
            Check connection
          </Button>
        )}
        <div className="flex flex-wrap gap-2">
          <div className="w-full">
            <HyperlinkScopePicker
              sheetId={props.sheetId}
              value={scope}
              disabled={busy}
              onChange={(next) => {
                run.current++;
                setScope(next);
                setHasReading(false);
                setRows([]);
                setPending(0);
                setStatus("Scope changed. Scan again to find destinations.");
              }}
            />
          </div>
          <Button
            className="self-end"
            variant="outline"
            disabled={
              busy ||
              emptyScope ||
              (reader !== "normal" && !readers?.[reader].available)
            }
            onClick={() => void scan(reader !== "normal" && hasReading)}
          >
            {reader === "normal"
              ? "Scan again"
              : hasReading
                ? "Read again"
                : "Scan with Terra"}
          </Button>
        </div>
        <p role="status" className="text-sm">
          {status}
        </p>
        {notes.length > 0 && (
          <details>
            <summary className="text-sm text-amber-600">
              {notes.length} search notes
            </summary>
            <ul className="max-h-36 overflow-auto pl-4 text-sm">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}
        {rows.length > 0 && (
          <>
            <Input
              aria-label="Search hyperlink results"
              placeholder="Search tags or destinations"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setRows((current) =>
                    current.map((r) => ({ ...r, selected: eligible(r) })),
                  )
                }
              >
                Select all ready
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setRows((current) =>
                    current.map((r) => ({ ...r, selected: false })),
                  )
                }
              >
                Select none
              </Button>
            </div>
          </>
        )}
        <div className="min-h-0 space-y-2 overflow-auto">
          {visible.map((row) => (
            <div key={row.tag} className="rounded border p-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={`Link ${row.tag}`}
                  checked={row.selected}
                  disabled={busy || !eligible(row)}
                  onChange={(e) =>
                    setRows((current) =>
                      current.map((r) =>
                        r.tag === row.tag
                          ? { ...r, selected: e.target.checked }
                          : r,
                      ),
                    )
                  }
                />
                <span className="min-w-0">
                  <strong>{row.tag}</strong>
                  <span className="text-muted-foreground block text-sm">
                    {row.occurrences} occurrences ·{" "}
                    {row.saved
                      ? "Saved"
                      : row.existing
                        ? "Already linked"
                        : row.overflow
                          ? "Too many destinations; link manually"
                          : `${row.links.length} destinations`}
                  </span>
                  {reader !== "normal" && (
                    <span className="text-muted-foreground block text-xs">
                      {row.needsPositionReview
                        ? "Check image-based tag positions"
                        : "Position matched to PDF text"}
                    </span>
                  )}
                </span>
              </label>
              {reader !== "normal" && (
                <a
                  className="mt-2 inline-block text-sm underline"
                  target="_blank"
                  rel="noreferrer"
                  href={
                    equipmentDrawingDestination({
                      jobId: props.jobId,
                      setId: props.setId,
                      sheetId: props.sheetId,
                      sourceSheetId: props.sourceId,
                      name: props.name,
                      tag: row.tag,
                      box: row.box,
                    }).href
                  }
                >
                  Review tag location
                </a>
              )}
              {row.error && (
                <p role="alert" className="text-destructive text-sm">
                  {row.error}
                </p>
              )}
              {row.links.length > 0 && (
                <details className="mt-2 text-sm">
                  <summary>Review destinations</summary>
                  <ul className="space-y-2 pt-2">
                    {row.links.map((l, i) => (
                      <li key={i}>
                        <a
                          className="break-words underline"
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {busy ? (
            <Button
              variant="outline"
              onClick={() => {
                run.current++;
                setBusy(false);
                setStatus("Stopped. Saved links are kept.");
              }}
            >
              Stop
            </Button>
          ) : (
            <Button variant="outline" onClick={props.onClose}>
              Done
            </Button>
          )}
          <Button
            disabled={
              busy ||
              pending > 0 ||
              !rows.some((r) => r.selected && eligible(r))
            }
            onClick={() => void saveSelected()}
          >
            Save selected links (
            {rows.filter((r) => r.selected && eligible(r)).length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
