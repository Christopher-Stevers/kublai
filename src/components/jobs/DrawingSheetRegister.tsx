"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { sourcePdfPage } from "~/lib/pdf-client";
import {
  readDrawingText,
  suggestSheetMetadata,
  type DrawingText,
} from "~/lib/drawing-text";
import {
  drawingMetadataSchema,
  type DrawingSheetSummary,
  type DrawingMetadata,
} from "~/lib/drawing-workspace";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

type Sheet = { id: string; name: string; imageUrl: string };
type Suggestion = {
  sheet: Sheet;
  number: string;
  title: string;
  discipline: string;
  selected: boolean;
  error?: string;
  base?: DrawingMetadata;
};
/** Title-block extraction is reviewed before it changes the shared sheet register. */
export function DrawingSheetRegister({
  jobId,
  sheets,
}: {
  jobId: string;
  sheets: Sheet[];
  summaries: DrawingSheetSummary[];
}) {
  const utils = api.useUtils();
  const mutation = api.drawingsWorkspace.metadata.useMutation();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Suggestion[]>([]),
    [status, setStatus] = useState("");
  const [region, setRegion] = useState({
    left: 0.65,
    top: 0,
    width: 0.35,
    height: 1,
  });
  const stop = useRef(false);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const scan = async () => {
    stop.current = false;
    setBusy(true);
    setRows([]);
    try {
      for (let index = 0; index < sheets.length; index++) {
        if (stop.current) break;
        const sheet = sheets[index]!;
        setStatus(`Reading ${index + 1} of ${sheets.length}: ${sheet.name}`);
        let base: DrawingMetadata | undefined;
        try {
          const workspace = await utils.drawingsWorkspace.get.fetch({
            sheetId: sheet.id,
          });
          base = workspace.metadata;
          const source = workspace.jobSheets.find(
            (item) => item.id === base!.currentSourceSheetId,
          );
          if (!source)
            throw Error(
              "The current drawing revision is unavailable. Reload before reading title blocks.",
            );
          const pdf = sourcePdfPage(source.imageUrl);
          let words: DrawingText[] = pdf
            ? (await readDrawingText(pdf)).words
            : [];
          words = words.filter(
            (w) =>
              w.left >= region.left &&
              w.top >= region.top &&
              w.right <= region.left + region.width + 0.01 &&
              w.bottom <= region.top + region.height + 0.01,
          );
          if (!words.length) {
            const response = await fetch("/api/drawings/ocr", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sheetId: source.id, region }),
            });
            const result = (await response.json()) as {
              words?: DrawingText[];
              error?: string;
              base?: DrawingMetadata;
            };
            if (!response.ok || !result.words)
              throw Error(result.error ?? "Recognition failed");
            words = result.words;
          }
          // The user-selected rectangle replaces the default title-block bounds.
          const suggestion = suggestSheetMetadata(
            words.map((w) => ({ ...w, left: 0.7, top: 0.7 })),
          );
          if (!stop.current)
            setRows((previous) => [
              ...previous,
              {
                sheet,
                base,
                ...suggestion,
                selected: Boolean(suggestion.number),
                error: suggestion.number
                  ? undefined
                  : "No sheet number found. Enter it below.",
              },
            ]);
        } catch (error) {
          if (!stop.current)
            setRows((previous) => [
              ...previous,
              {
                sheet,
                base,
                number: "",
                title: "",
                discipline: "",
                selected: false,
                error:
                  error instanceof Error ? error.message : "Recognition failed",
              },
            ]);
        }
      }
      setStatus(
        stop.current
          ? "Stopped. Completed suggestions are available below."
          : "Review and correct the suggestions before saving.",
      );
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    stop.current = false;
    setBusy(true);
    let saved = 0;
    try {
      for (const row of rows.filter((r) => r.selected)) {
        if (stop.current) break;
        try {
          if (!row.base)
            throw Error("Read this sheet again before saving its details.");
          await mutation.mutateAsync({
            sheetId: row.sheet.id,
            expectedRevision: row.base.revision,
            data: drawingMetadataSchema.parse({
              ...row.base,
              number: row.number,
              title: row.title,
              discipline: row.discipline,
            }),
          });
          saved++;
          setRows((previous) =>
            previous.map((item) =>
              item.sheet.id === row.sheet.id
                ? { ...item, selected: false, error: undefined }
                : item,
            ),
          );
        } catch (error) {
          setRows((previous) =>
            previous.map((item) =>
              item.sheet.id === row.sheet.id
                ? {
                    ...item,
                    error:
                      error instanceof Error ? error.message : "Could not save",
                  }
                : item,
            ),
          );
        }
      }
      await utils.drawingsWorkspace.list.invalidate({ jobId });
      setStatus(
        `${saved} sheet details saved. Any failed rows remain selected for review.`,
      );
    } finally {
      setBusy(false);
    }
  };
  const edit = (id: string, patch: Partial<Suggestion>) =>
    setRows((previous) =>
      previous.map((row) => (row.sheet.id === id ? { ...row, ...patch } : row)),
    );
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Read title blocks
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) stop.current = true;
          setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Drawing register from title blocks</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Choose the title block area as a percentage of the page. Text is
            read locally; scans use recognition on ForemanHQ&apos;s server.
            Every suggestion can be corrected before saving.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {(["left", "top", "width", "height"] as const).map((key) => (
              <label className="text-xs capitalize" key={key}>
                {key} %
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(region[key] * 100)}
                  disabled={busy}
                  onChange={(e) =>
                    setRegion((old) => ({
                      ...old,
                      [key]: Number(e.target.value) / 100,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              disabled={
                busy ||
                !sheets.length ||
                region.width <= 0 ||
                region.height <= 0 ||
                region.left + region.width > 1 ||
                region.top + region.height > 1
              }
              onClick={() => void scan()}
            >
              Read {sheets.length} sheets
            </Button>
            {busy && (
              <Button
                variant="outline"
                onClick={() => {
                  stop.current = true;
                }}
              >
                Stop
              </Button>
            )}
          </div>
          {status && (
            <p role="status" className="text-sm">
              {status}
            </p>
          )}
          {rows.length > 0 && (
            <div className="space-y-3">
              {rows.map((row) => (
                <fieldset key={row.sheet.id} className="rounded border p-3">
                  <legend className="px-1 text-sm">
                    <label>
                      <input
                        type="checkbox"
                        checked={row.selected}
                        disabled={busy}
                        onChange={(e) =>
                          edit(row.sheet.id, { selected: e.target.checked })
                        }
                      />{" "}
                      {row.sheet.name}
                    </label>
                  </legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(["number", "title", "discipline"] as const).map((key) => (
                      <label className="text-xs capitalize" key={key}>
                        {key}
                        <Input
                          aria-label={`${row.sheet.name} ${key}`}
                          disabled={busy}
                          maxLength={255}
                          value={row[key]}
                          onChange={(e) =>
                            edit(row.sheet.id, { [key]: e.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {row.error && (
                    <p className="mt-1 text-xs text-amber-700">{row.error}</p>
                  )}
                </fieldset>
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <Button
              disabled={busy || !rows.some((row) => row.selected)}
              onClick={() => void apply()}
            >
              Save selected sheet details
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
