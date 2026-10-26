"use client";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import type { SlipAnalysis } from "~/lib/packing-slip-review";

/** Actual worker results, never a timed simulation of approval. */
export function SlipProcessingProgress({ analysis, order = "" }: { analysis: SlipAnalysis | null; order?: string }) {
  if (!analysis) return null;
  const processing = analysis.status === "processing";
  const failed = analysis.status === "failed";
  const lines = failed ? [] : processing ? analysis.progress?.lines ?? [] : analysis.lines;
  const flagged = (line: (typeof lines)[number]) => !line.orderItemId || line.proposed === null || line.issues.length > 0 || !line.quantityClear || (!!line.confidence && line.confidence !== "high") || line.handwritten !== undefined;
  const checks = lines.filter(flagged).length;
  const progress = analysis.progress;
  const title = failed ? "Packing slip could not be checked" : processing ? "Checking packing slip" : "Packing slip checks complete";
  return (
    <section aria-label="Live packing slip checks" className="bg-card mb-3 space-y-2 rounded-xl border p-3 text-sm">
      <div className="flex items-start gap-2" role="status" aria-live="polite">
        {processing ? <Loader2Icon className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" /> : failed || checks ? <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
        <div className="min-w-0">
          <p className="font-semibold">{title}{order}</p>
          <p className="text-muted-foreground text-xs">{failed ? analysis.error ?? "Open Packing slips to retry detection." : processing ? progress?.message ?? "Waiting for the scan reader…" : `${lines.length - checks} checked · ${checks} flagged for review`}</p>
          {processing && progress?.total !== undefined && <p className="mt-1 text-xs tabular-nums">{progress.completed ?? 0} of {progress.total} lines checked · {checks} flagged</p>}
        </div>
      </div>
      {processing && !!progress?.total && <progress aria-label="Slip lines checked" max={progress.total} value={progress.completed ?? 0} className="h-1.5 w-full accent-current" />}
      {failed && <p className="text-xs">Open Packing slips to rerun detection or review the order manually.</p>}
      {lines.length > 0 && <ul aria-label="Line check results" className="max-h-56 space-y-2 overflow-y-auto overscroll-contain border-t pt-2">
        {lines.map((line, index) => {
          const item = analysis.items.find((i) => i.id === line.orderItemId);
          const flag = flagged(line);
          return <li key={`${line.page}:${line.box?.y ?? index}:${line.evidence}`} className="flex items-start gap-2">
            {flag ? <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <CheckCircle2Icon className={`mt-0.5 size-4 shrink-0 ${processing ? "text-muted-foreground" : "text-emerald-600"}`} />}
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{item?.description ?? line.description ?? line.evidence}</p>
              <p className={`text-xs ${flag ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}>
                {flag ? "Flagged" : processing ? "Matched · final checks pending" : "Checked · ready to confirm"}
                {line.shipped !== null && ` · Slip ${line.shipped} ${line.unit ?? ""}`}
              </p>
              {flag && <p className="text-muted-foreground text-xs">{line.issues.join(" ") || (line.handwritten !== undefined ? "Check handwritten quantity." : "Match the part and check its quantity.")}</p>}
            </div>
          </li>;
        })}
      </ul>}
      {!failed && <p className="text-muted-foreground text-xs">{processing ? "Matches are provisional until totals and duplicate checks finish." : "Review flagged parts, then confirm the delivery to update received quantities."}</p>}
    </section>
  );
}
