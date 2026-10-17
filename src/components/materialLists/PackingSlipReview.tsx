"use client";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  proposedReceipts,
  receiptIssues,
  type SlipAnalysis,
} from "~/lib/packing-slip-review";
export function PackingSlipReview({
  analysis,
  versionId,
  onAction,
  busy,
}: {
  analysis?: SlipAnalysis;
  versionId: string | null;
  onAction: (
    action: "analyze" | "refresh" | "confirm",
    quantities?: Record<string, number>,
  ) => Promise<void>;
  busy: boolean;
}) {
  const proposed = analysis ? proposedReceipts(analysis) : {};
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(proposed).map(([id, n]) => [id, String(n)]),
    ),
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [checked, setChecked] = useState(false),
    [error, setError] = useState("");
  if (!analysis || analysis.status === "failed")
    return (
      <div className="space-y-2 text-sm">
        <p>
          {analysis?.error ?? "Read the slip and propose delivery quantities."}
        </p>
        <Button
          disabled={busy}
          size="sm"
          variant="outline"
          onClick={() => void onAction("analyze")}
        >
          {analysis ? "Retry analysis" : "Analyze slip"}
        </Button>
      </div>
    );
  if (analysis.applied)
    return (
      <details className="space-y-2" open>
        <summary className="cursor-pointer text-sm" role="status">
          ✓ Receipt confirmed {new Date(analysis.applied.at).toLocaleString()}.
          This slip will not be counted again.
        </summary>
        {analysis.items.map((item) => (
          <div className="rounded border p-2 text-sm" key={item.id}>
            <p className="font-medium">{item.description}</p>
            <p>
              Slip shipped:{" "}
              {proposed[item.id] === undefined
                ? "Unclear"
                : `${proposed[item.id]} ${item.unit}`}
            </p>
            <p>
              Confirmed this delivery:{" "}
              {analysis.applied!.quantities[item.id] === undefined
                ? "Not changed"
                : `${analysis.applied!.quantities[item.id]} ${item.unit}`}
            </p>
            {analysis.applied!.quantities[item.id] !== undefined &&
              proposed[item.id] !== undefined &&
              analysis.applied!.quantities[item.id] !== proposed[item.id] && (
                <p className="text-amber-700 dark:text-amber-300">
                  ⚠ Delivery differs from the slip.
                </p>
              )}
          </div>
        ))}
        {analysis.lines
          .filter((l) => l.issues.length)
          .map((l, i) => (
            <p key={i} className="text-sm text-amber-700 dark:text-amber-300">
              Page {l.page}: {l.evidence} — {l.issues.join(" ")}
            </p>
          ))}
      </details>
    );
  if (analysis.status === "processing")
    return (
      <div className="text-sm">
        <p role="status">
          Reading packing slip and comparing it with the order… You can close
          this window.
        </p>
        {now - Date.parse(analysis.startedAt) > 15 * 60_000 && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => void onAction("analyze")}
          >
            Retry interrupted analysis
          </Button>
        )}
      </div>
    );
  if (analysis.versionId !== versionId)
    return (
      <Button disabled={busy} onClick={() => void onAction("analyze")}>
        Analyze updated slip
      </Button>
    );
  const confirm = async () => {
    setError("");
    const quantities: Record<string, number> = {};
    for (const [id, text] of Object.entries(values)) {
      if (!text.trim()) continue;
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0 || n > 999999) {
        setError("Enter a valid quantity for this delivery.");
        return;
      }
      quantities[id] = n;
    }
    if (!Object.keys(quantities).length) {
      setError("Enter at least one received quantity.");
      return;
    }
    await onAction("confirm", quantities);
  };
  return (
    <details className="space-y-3" open>
      <summary className="cursor-pointer font-medium">Review delivery</summary>
      <p className="text-sm">
        These are suggestions from the slip. Count what arrived, correct the
        quantities below, then confirm. Quantities entered here are for this
        delivery and add to previous receipts. Blank fields stay unchanged.
      </p>
      {analysis.lines.some((l) => l.issues.length > 0) && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          ⚠ {analysis.lines.filter((l) => l.issues.length > 0).length} slip
          lines need attention. Review the matching issues below.
        </p>
      )}
      {analysis.warnings.map((warning, i) => (
        <p key={i} className="text-sm text-amber-700 dark:text-amber-300">
          ⚠ {warning}
        </p>
      ))}
      <div className="space-y-3">
        {analysis.items.map((item) => {
          const value = values[item.id] ?? "",
            n =
              value.trim() && Number.isFinite(Number(value))
                ? Number(value)
                : undefined;
          const flags = receiptIssues(item, proposed[item.id]);
          const mismatch =
            n !== undefined &&
            proposed[item.id] !== undefined &&
            Math.abs(n - proposed[item.id]!) > 1e-6;
          return (
            <div key={item.id} className="space-y-2 rounded border p-3 text-sm">
              <p className="font-medium">{item.description}</p>
              {item.sku && (
                <p className="text-muted-foreground">SKU {item.sku}</p>
              )}
              <p>
                Ordered: {item.ordered} {item.unit} · Already received:{" "}
                {item.received} {item.unit}
              </p>
              <p>
                Slip shipped:{" "}
                {proposed[item.id] === undefined
                  ? "Needs review"
                  : `${proposed[item.id]} ${item.unit}`}
              </p>
              {flags.map((f) => (
                <p key={f} className="text-amber-700 dark:text-amber-300">
                  ⚠ {f}
                </p>
              ))}
              <label className="flex items-center gap-2">
                Received this delivery{" "}
                <Input
                  aria-label={`Received this delivery: ${item.description}`}
                  type="number"
                  min="0"
                  max="999999"
                  step="any"
                  inputMode="decimal"
                  value={value}
                  disabled={busy}
                  onChange={(e) => {
                    setChecked(false);
                    setValues((old) => ({ ...old, [item.id]: e.target.value }));
                  }}
                  className="w-24"
                />{" "}
                {item.unit}
              </label>
              {n !== undefined && (
                <p>
                  New received total:{" "}
                  {Math.round((item.received + n) * 1e6) / 1e6} {item.unit}
                </p>
              )}
              {mismatch && (
                <p className="text-amber-700 dark:text-amber-300">
                  ⚠ Actual receipt differs from slip. The order item will be
                  flagged.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <details open={analysis.lines.some((l) => !l.orderItemId)}>
        <summary className="cursor-pointer text-sm">
          Slip lines and matching issues ({analysis.lines.length})
        </summary>
        <div className="space-y-2">
          {analysis.lines.map((line, i) => (
            <div key={i} className="border-b py-2 text-sm">
              <p>
                Page {line.page}: {line.evidence}
              </p>
              <p>
                Shipped: {line.shipped ?? "unclear"} {line.unit ?? ""}
                {line.backordered !== null
                  ? ` · Backordered: ${line.backordered}`
                  : ""}
              </p>
              {line.issues.map((issue) => (
                <p key={issue} className="text-amber-700 dark:text-amber-300">
                  ⚠ {issue}
                </p>
              ))}
            </div>
          ))}
        </div>
      </details>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(e) => setChecked(e.target.checked)}
        />{" "}
        I checked the physical delivery and reviewed the flagged differences.
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !checked} onClick={() => void confirm()}>
          Confirm received quantities
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void onAction("refresh")}
        >
          Refresh totals
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void onAction("analyze")}
        >
          Reanalyze slip
        </Button>
      </div>
    </details>
  );
}
