"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { uploadDrawings } from "~/lib/upload-drawings";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { notify } from "~/components/ui/app-dialogs";
type BulkProps = {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => Promise<void>;
};
export function BulkDrawingRevisions(props: BulkProps) {
  return props.open ? <BulkDrawingRevisionDialog {...props} /> : null;
}
function BulkDrawingRevisionDialog({
  jobId,
  open,
  onOpenChange,
  onComplete,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => Promise<void>;
}) {
  const [setId, setSetId] = useState<string | null>(null),
    [uploaded, setUploaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [label, setLabel] = useState(""),
    [choices, setChoices] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    revised: string[];
    newSheets: string[];
    needsCalibration: string[];
    calibrationRetained: string[];
    impactCount: number;
  } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const create = api.drawings.createSet.useMutation(),
    apply = api.drawingsWorkspace.applyRevisionUpload.useMutation();
  const review = api.drawingsWorkspace.reviewRevisionUpload.useQuery(
    { uploadedSetId: setId ?? "" },
    {
      enabled: open && uploaded && !!setId,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  );
  useEffect(() => {
    if (!review.data) return;
    setChoices(
      Object.fromEntries(
        review.data.rows.map((row) => [
          row.sourceId,
          row.alreadyAttached
            ? "skip"
            : (row.targetId ?? (row.status === "new" ? "new" : "skip")),
        ]),
      ),
    );
  }, [review.data]);
  const upload = async (selected: File) => {
    setBusy(true);
    setError("");
    try {
      const target =
        setId ??
        (
          await create.mutateAsync({
            jobId,
            name: `Revisions · ${selected.name}`.slice(0, 255),
          })
        ).id;
      setSetId(target);
      setLabel(selected.name.replace(/\.pdf$/i, ""));
      await uploadDrawings(jobId, selected, { drawingSetId: target });
      setUploaded(true);
      await onComplete();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Upload failed. Choose the same PDF to resume.",
      );
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };
  const rows = review.data?.rows ?? [];
  const selected = rows.filter(
    (row) => choices[row.sourceId] && choices[row.sourceId] !== "skip",
  );
  const targets = selected
    .map((row) => choices[row.sourceId])
    .filter((id) => id !== "new");
  const duplicate = new Set(targets).size !== targets.length;
  const confirm = async () => {
    if (!setId || !review.data) return;
    setError("");
    try {
      const saved = await apply.mutateAsync({
        uploadedSetId: setId,
        label,
        rows: selected.map((row) => {
          const target = review.data.targets.find(
            (t) => t.id === choices[row.sourceId],
          );
          return {
            sourceId: row.sourceId,
            sourceRevision: row.sourceRevision,
            targetId: target?.id ?? null,
            expectedRevision: target?.revision,
          };
        }),
      });
      setResult(saved);
      await onComplete();
      notify(
        "Revised drawings are current. Previous versions were retained.",
        "success",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not apply revisions. Nothing was changed.",
      );
    }
  };
  const reset = () => {
    setSetId(null);
    setUploaded(false);
    setResult(null);
    setChoices({});
    setLabel("");
    setError("");
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy && !apply.isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Upload revised drawings</DialogTitle>
          <DialogDescription>
            Upload one revised PDF, review the matches, then confirm. Original
            drawings and their history are retained.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto">
          {result ? (
            <>
              <p role="status">
                {result.revised.length} revisions made current ·{" "}
                {result.newSheets.length} new drawings ·{" "}
                {result.calibrationRetained.length} calibrations retained.
              </p>
              {!!result.needsCalibration.length && (
                <div className="rounded-md border border-amber-500 p-3">
                  <p className="font-medium">
                    Check calibration before measuring
                  </p>
                  <p className="text-sm">
                    {result.needsCalibration.join(", ")}
                  </p>
                </div>
              )}
              <p className="text-sm">
                {result.impactCount} possible markup/takeoff impacts flagged.
                Open a revised drawing and choose Needs review to compare and
                acknowledge them.
              </p>
              <p className="text-muted-foreground text-sm">
                Revised drawings are Draft until reviewed. Unselected uploaded
                pages remain in their new folder for later review.
              </p>
            </>
          ) : (
            <>
              {!uploaded && (
                <>
                  <input
                    ref={file}
                    type="file"
                    accept="application/pdf,.pdf"
                    aria-label="Revised PDF"
                    className="hidden"
                    onChange={(event) => {
                      const chosen = event.target.files?.[0];
                      if (chosen) void upload(chosen);
                    }}
                  />
                  <Button disabled={busy} onClick={() => file.current?.click()}>
                    {busy
                      ? "Uploading and reading drawings…"
                      : setId
                        ? "Retry PDF upload"
                        : "Choose revised PDF"}
                  </Button>
                  <p className="text-muted-foreground text-sm">
                    Each page is added to a separate revisions folder. Closing
                    this review never deletes uploaded files.
                  </p>
                </>
              )}
              {uploaded && review.isFetching && (
                <p role="status">
                  Matching drawing numbers and checking calibration evidence…
                </p>
              )}
              {review.error && (
                <div role="alert">
                  <p>{review.error.message}</p>
                  <Button
                    variant="outline"
                    onClick={() => void review.refetch()}
                  >
                    Retry review
                  </Button>
                </div>
              )}
              {review.data && (
                <>
                  <label className="block text-sm">
                    Revision label
                    <Input
                      value={label}
                      maxLength={255}
                      onChange={(event) => setLabel(event.target.value)}
                    />
                  </label>
                  <p className="text-sm">
                    {rows.filter((r) => r.status === "matched").length} matched
                    · {rows.filter((r) => r.status === "new").length} new ·{" "}
                    {rows.filter((r) => r.status === "uncertain").length} need a
                    choice
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Confirmed revisions become current and return to Draft.
                    Verified calibrations are kept; otherwise check scale before
                    measuring. New drawings remain in the uploaded folder.
                  </p>
                  {rows.map((row) => {
                    const value = choices[row.sourceId] ?? "skip",
                      manual =
                        value !== "skip" &&
                        value !== "new" &&
                        value !== row.targetId;
                    return (
                      <div
                        key={row.sourceId}
                        className="space-y-2 rounded-md border p-3"
                      >
                        <p className="font-medium">{row.sourceName}</p>
                        <p className="text-muted-foreground text-xs">
                          {row.alreadyAttached
                            ? "Already attached to revision history."
                            : row.reason}
                        </p>
                        <select
                          className="bg-background h-11 w-full min-w-0 rounded-md border px-2 text-base"
                          aria-label={`Revision destination for ${row.sourceName}`}
                          value={value}
                          disabled={row.alreadyAttached || apply.isPending}
                          onChange={(event) =>
                            setChoices((old) => ({
                              ...old,
                              [row.sourceId]: event.target.value,
                            }))
                          }
                        >
                          <option value="skip">Leave for later review</option>
                          <option value="new">Keep as a new drawing</option>
                          {review.data.targets.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                              {target.setName ? ` · ${target.setName}` : ""}
                            </option>
                          ))}
                        </select>
                        {value !== "skip" && value !== "new" && (
                          <p
                            className={`text-xs ${manual || !row.calibration.preserve ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
                          >
                            {manual
                              ? "Manual match: calibration compatibility will be checked on confirmation."
                              : row.calibration.reason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {duplicate && (
                    <p role="alert" className="text-destructive text-sm">
                      Two uploaded pages cannot both replace the same drawing.
                      Choose one.
                    </p>
                  )}
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t pt-3">
          {result ? (
            <>
              <Button variant="outline" onClick={reset}>
                Upload another PDF
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy || apply.isPending}
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              {review.data && (
                <Button
                  disabled={
                    !selected.length ||
                    duplicate ||
                    !label.trim() ||
                    apply.isPending
                  }
                  onClick={() => void confirm()}
                >
                  {apply.isPending
                    ? "Applying…"
                    : `Confirm ${selected.length} drawings`}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
