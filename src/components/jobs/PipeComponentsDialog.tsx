"use client";

import { useRef, useState } from "react";
import {
  CheckIcon,
  LocateFixedIcon,
  DownloadIcon,
  ScanLineIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import type { DrawingEntity, DrawingMarkup } from "~/lib/drawing-workspace";
import {
  PIPE_COMPONENT_KINDS,
  PIPE_COMPONENT_NAMES,
  type PipeComponentCandidate,
  type PipeComponentKind,
  type PipeComponentsResult,
} from "~/lib/pipe-components-types";
import {
  pipeComponentsCsv,
  reviewedPipeComponent,
} from "~/lib/pipe-component-review";

type Details = {
  kind: PipeComponentKind;
  name: string;
  size?: string;
  material?: string;
};
function CandidateRow({
  candidate,
  reviewed,
  writable,
  onLocate,
  onConfirm,
  onDismiss,
}: {
  candidate: PipeComponentCandidate;
  reviewed?: DrawingEntity;
  writable: boolean;
  onLocate: () => void;
  onConfirm: (details: Details) => Promise<boolean>;
  onDismiss: () => void;
}) {
  const [details, setDetails] = useState<Details>(candidate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);
  const saving = useRef(false);
  const confirmed = !!reviewed;
  const known = (value: string | undefined, fallback: string) =>
    value?.trim() ? value.trim() : fallback;
  const meta = reviewed
    ? (reviewed.data as DrawingMarkup).pipeComponent
    : undefined;
  return (
    <li className="space-y-2 border-b py-3 last:border-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">
            {meta?.name ?? details.name}
          </p>
          <p className="text-muted-foreground text-xs">
            {known(meta?.size ?? details.size, "Size unknown")} ·{" "}
            {known(meta?.material ?? details.material, "Material unknown")}
          </p>
        </div>
        {confirmed && (
          <span className="text-primary flex items-center gap-1 text-xs">
            <CheckIcon className="size-3" />
            Reviewed
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Locate ${candidate.name}`}
          onClick={onLocate}
        >
          <LocateFixedIcon className="size-4" />
        </Button>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed break-words">
        {candidate.evidence}
      </p>
      {editing && !confirmed && (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="space-y-1">
            Type
            <select
              aria-label="Component type"
              className="bg-background h-9 w-full rounded border px-2"
              value={details.kind}
              onChange={(event) => {
                const kind = event.target.value as PipeComponentKind;
                setDetails({
                  ...details,
                  kind,
                  name: PIPE_COMPONENT_NAMES[kind],
                });
              }}
            >
              {PIPE_COMPONENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PIPE_COMPONENT_NAMES[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            Name
            <input
              aria-label="Component name"
              className="bg-background h-9 w-full rounded border px-2"
              value={details.name}
              maxLength={120}
              onChange={(event) =>
                setDetails({ ...details, name: event.target.value })
              }
            />
          </label>
          <label className="space-y-1">
            Size
            <input
              aria-label="Component size"
              className="bg-background h-9 w-full rounded border px-2"
              value={details.size ?? ""}
              maxLength={80}
              placeholder="Unknown"
              onChange={(event) =>
                setDetails({ ...details, size: event.target.value })
              }
            />
          </label>
          <label className="space-y-1">
            Material
            <input
              aria-label="Component material"
              className="bg-background h-9 w-full rounded border px-2"
              value={details.material ?? ""}
              maxLength={80}
              placeholder="Unknown"
              onChange={(event) =>
                setDetails({ ...details, material: event.target.value })
              }
            />
          </label>
        </div>
      )}
      {!confirmed && (
        <div className="flex flex-wrap gap-2">
          {writable && (
            <>
              <Button
                size="sm"
                disabled={busy || !details.name.trim()}
                onClick={async () => {
                  if (saving.current) return;
                  saving.current = true;
                  setBusy(true);
                  setError(false);
                  try {
                    const ok = await onConfirm({
                      ...details,
                      name: details.name.trim(),
                    });
                    setError(!ok);
                  } catch {
                    setError(true);
                  } finally {
                    saving.current = false;
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Saving…" : "Confirm count"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setEditing(!editing)}
              >
                {editing ? "Hide fields" : "Edit details"}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          Could not save this count. Try again.
        </p>
      )}
    </li>
  );
}

export function PipeComponentsDialog({
  open,
  onOpenChange,
  result,
  analyzing,
  error,
  sourceKey,
  annotations,
  writable,
  templateCount,
  onAnalyze,
  onLocate,
  onConfirm,
  onTeach,
  onDismiss,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PipeComponentsResult | null;
  analyzing: boolean;
  error: string | null;
  sourceKey: string;
  annotations: DrawingEntity[];
  writable: boolean;
  templateCount: number;
  onAnalyze: () => void;
  onLocate: (candidate: PipeComponentCandidate) => void;
  onConfirm: (
    candidate: PipeComponentCandidate,
    details: Details,
  ) => Promise<boolean>;
  onTeach: (kind: PipeComponentKind, name: string) => void;
  onDismiss?: (candidate: PipeComponentCandidate) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [limit, setLimit] = useState(50);
  const [kind, setKind] = useState<PipeComponentKind>("valve");
  const [name, setName] = useState("Valve");
  const candidates = result?.candidates ?? [];
  const reviewed = candidates.flatMap((candidate) => {
    const record = reviewedPipeComponent(annotations, sourceKey, candidate);
    return record ? [record.data as DrawingMarkup] : [];
  });
  const visible = candidates.filter(
    (candidate) => showAll || !dismissed.has(candidate.id),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] max-w-[calc(100%-1rem)] flex-col gap-3 p-4 sm:max-w-xl">
        <div className="space-y-2 pr-7">
          <DialogTitle>Fittings & valves</DialogTitle>
          <DialogDescription>
            This sheet’s selected piping system. Review each candidate before
            adding it to the count.
          </DialogDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-y py-2 text-sm">
          <strong className="tabular-nums">
            {candidates.length} candidates · {reviewed.length} reviewed
          </strong>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={analyzing}
            onClick={onAnalyze}
          >
            {analyzing ? "Analyzing…" : "Recheck"}
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Export reviewed counts"
            disabled={!reviewed.length}
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([pipeComponentsCsv(reviewed)], {
                  type: "text/csv;charset=utf-8",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "piping-components-reviewed.csv";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            <DownloadIcon className="size-4" />
          </Button>
        </div>
        {reviewed.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {PIPE_COMPONENT_KINDS.flatMap((kind) => {
              const count = reviewed.filter(
                (record) => record.pipeComponent?.kind === kind,
              ).length;
              return count ? [`${PIPE_COMPONENT_NAMES[kind]}: ${count}`] : [];
            }).join(" · ")}
          </p>
        )}
        {result?.partial && <p role="status" className="text-sm text-muted-foreground">Some symbols could not be analyzed. Check the analysis notes and review the drawing.</p>}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {analyzing && (
            <p role="status" className="text-muted-foreground py-4 text-sm">
              Comparing saved legend symbols, nearby tags and the selected pipe…
            </p>
          )}
          {!analyzing && result && !candidates.length && (
            <p className="text-muted-foreground py-4 text-sm">
              No components were identified. Review and save Legend Items for this drawing set, or add a count markup manually. Scanned drawings need manual review.
            </p>
          )}
          <ul aria-label="Component candidates">
            {visible.slice(0, limit).map((candidate) => (
              <CandidateRow
                key={`${sourceKey}:${candidate.id}`}
                candidate={candidate}
                reviewed={reviewedPipeComponent(
                  annotations,
                  sourceKey,
                  candidate,
                )}
                writable={writable && !analyzing}
                onLocate={() => onLocate(candidate)}
                onConfirm={(details) => onConfirm(candidate, details)}
                onDismiss={() => {
                  setDismissed((old) => new Set([...old, candidate.id]));
                  onDismiss?.(candidate);
                }}
              />
            ))}
          </ul>
          {visible.length > limit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLimit(limit + 50)}
            >
              Show 50 more
            </Button>
          )}
          {dismissed.size > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll
                ? "Hide dismissed"
                : `Show dismissed (${dismissed.size})`}
            </Button>
          )}
        </div>
        <details className="max-h-[35dvh] shrink-0 overflow-y-auto border-t pt-2 text-sm">
          <summary className="cursor-pointer">
            Symbol references ({templateCount}) & analysis notes
          </summary>
          <div className="mt-2 space-y-2">
            {result?.warnings.map((warning) => (
              <p key={warning} className="text-muted-foreground text-xs">
                {warning}
              </p>
            ))}
            {writable && (
              <>
                <p className="text-xs">
                  Teach one vector symbol: choose its type and name, then tap
                  two opposite corners around the symbol on the drawing. Saved
                  references appear on the “Piping symbol references” layer.
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Symbol type"
                    className="bg-background h-9 rounded border px-2"
                    value={kind}
                    onChange={(event) => {
                      const value = event.target.value as PipeComponentKind;
                      setKind(value);
                      setName(PIPE_COMPONENT_NAMES[value]);
                    }}
                  >
                    {PIPE_COMPONENT_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {PIPE_COMPONENT_NAMES[value]}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Symbol name"
                    className="bg-background h-9 min-w-0 flex-1 rounded border px-2"
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!name.trim()}
                    onClick={() => onTeach(kind, name.trim())}
                  >
                    <ScanLineIcon className="size-4" />
                    Pick symbol
                  </Button>
                </div>
              </>
            )}
          </div>
        </details>
      </DialogContent>
    </Dialog>
  );
}
