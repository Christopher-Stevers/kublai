"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2Icon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import {
  MATCH_ISSUE,
  convertSlipQuantity,
  type ReceiptOrderItem,
  type SlipAnalysis,
  type SlipLine,
} from "~/lib/packing-slip-review";
import { SlipLineImage } from "./SlipLineImage";

type Links = Record<number, string | null>;
type Status = "review" | "short" | "over" | "complete" | "missing";
type Filter = "all" | Status;
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const fmt = (n: number, unit: string) => `${round(n)} ${unit}`;
const STATUS: Record<Status, { label: string; tone: string; bar: string }> = {
  complete: {
    label: "Complete",
    tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    bar: "bg-emerald-500",
  },
  short: {
    label: "Outstanding",
    tone: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
    bar: "bg-sky-400",
  },
  over: {
    label: "Over order",
    tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
    bar: "bg-red-500",
  },
  review: {
    label: "Needs review",
    tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    bar: "bg-amber-400",
  },
  missing: {
    label: "Not on slip",
    tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    bar: "bg-transparent",
  },
};
const FILTERS: Array<[Filter, string]> = [
  ["all", "All"],
  ["review", "Needs review"],
  ["short", "Outstanding"],
  ["over", "Over"],
  ["complete", "Complete"],
  ["missing", "Not on slip"],
];

/** What a slip line adds to the item it is linked to; null when unclear.
 * Mirrors the server's handling of hand-linked lines. */
function lineAmount(
  line: SlipLine,
  itemId: string,
  item: ReceiptOrderItem | undefined,
) {
  if (itemId === line.orderItemId) return line.proposed;
  if (!item || !line.quantityClear || line.shipped === null) return null;
  const pack = !!item.piecesPerPack && item.piecesPerPack > 1;
  return convertSlipQuantity(
    line.shipped,
    line.unit ?? (pack ? null : item.unit),
    item,
  );
}

function suggestions(analysis: SlipAnalysis, links: Links) {
  const amounts: Record<string, number> = {};
  analysis.lines.forEach((line, i) => {
    const id = i in links ? links[i] : line.orderItemId;
    if (!id) return;
    const n = lineAmount(
      line,
      id,
      analysis.items.find((x) => x.id === id),
    );
    if (n !== null) amounts[id] = round((amounts[id] ?? 0) + n);
  });
  return amounts;
}

/** Issues still open on a line; a line the user linked has its match settled. */
const openIssues = (line: SlipLine, linked: boolean) =>
  linked ? line.issues.filter((i) => !MATCH_ISSUE.test(i)) : line.issues;

export function PackingSlipReview({
  analysis,
  versionId,
  jobId,
  onAction,
  busy,
}: {
  analysis?: SlipAnalysis;
  versionId: string | null;
  /** Shows each slip line as printed; without it the read text is shown. */
  jobId?: string;
  onAction: (
    action: "analyze" | "refresh" | "confirm",
    quantities?: Record<string, number>,
    links?: Record<string, string | null>,
  ) => Promise<void>;
  busy: boolean;
}) {
  const [links, setLinks] = useState<Links>({});
  const proposed = useMemo(
    () => (analysis ? suggestions(analysis, links) : {}),
    [analysis, links],
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(analysis ? suggestions(analysis, {}) : {}).map(
        ([id, n]) => [id, String(n)],
      ),
    ),
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [checked, setChecked] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState<Filter>("all");

  if (!analysis || analysis.status === "failed")
    return (
      <div className="bg-muted/40 space-y-2 rounded-lg p-3 text-sm">
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
  if (analysis.applied) return <Applied analysis={analysis} />;
  if (analysis.status === "processing")
    return (
      <div className="bg-muted/40 space-y-3 rounded-lg p-3 text-sm">
        <p role="status" className="flex items-center gap-2">
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
          Reading packing slip and comparing it with the order… You can close
          this window.
        </p>
        <ol className="text-muted-foreground ml-6 list-decimal space-y-0.5">
          <li>Find the item table and its columns</li>
          <li>Read shipped and backordered quantities</li>
          <li>Match each slip line to an order item</li>
        </ol>
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

  const fileUrl = jobId
    ? `/api/job-documents/files/${analysis.versionId}?jobId=${encodeURIComponent(jobId)}`
    : null;
  const headerFor = (page: number) => {
    const h = analysis.headers?.find((x) => x.page === page);
    return h ? { page: h.printedOn ?? h.page, box: h.box } : undefined;
  };
  const printed = (line: SlipLine, index: number) =>
    fileUrl && line.box ? (
      <SlipLineImage
        url={fileUrl}
        page={line.page}
        box={line.box}
        header={headerFor(line.page)}
        label={`Slip line ${index + 1} as printed on page ${line.page}`}
      />
    ) : (
      <p className="bg-muted/50 rounded px-2 py-1 font-mono text-xs break-words">
        {line.evidence}
      </p>
    );
  const linkOf = (i: number) =>
    i in links ? links[i]! : analysis.lines[i]!.orderItemId;
  const rows = analysis.items.map((item) => {
    const lines = analysis.lines
      .map((line, index) => ({ line, index }))
      .filter(({ index }) => linkOf(index) === item.id);
    const value = values[item.id] ?? "";
    const n =
      value.trim() && Number.isFinite(Number(value))
        ? Number(value)
        : undefined;
    const suggested = proposed[item.id];
    const amount = n ?? suggested;
    const total = item.received + (amount ?? 0);
    const status: Status =
      !lines.length && n === undefined
        ? "missing"
        : amount === undefined
          ? "review"
          : total > item.ordered + 1e-6
            ? "over"
            : total < item.ordered - 1e-6
              ? "short"
              : "complete";
    return { item, lines, value, n, suggested, total, status };
  });
  const extras = analysis.lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => !linkOf(index));
  const counts = Object.fromEntries(
    FILTERS.map(([f]) => [
      f,
      f === "all" ? rows.length : rows.filter((r) => r.status === f).length,
    ]),
  ) as Record<Filter, number>;
  const visible = rows.filter((r) => filter === "all" || r.status === filter);

  const link = (index: number, itemId: string | null) => {
    const before = proposed;
    const next = { ...links };
    if (itemId === analysis.lines[index]!.orderItemId) delete next[index];
    else next[index] = itemId;
    const after = suggestions(analysis, next);
    setLinks(next);
    setChecked(false);
    setValues((old) => {
      const v = { ...old };
      for (const id of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ])) {
        if (before[id] === after[id]) continue;
        const current = v[id] ?? "";
        // Only replace a quantity the user has not typed over.
        if (
          !current.trim() ||
          (before[id] !== undefined && Number(current) === before[id])
        )
          v[id] = after[id] === undefined ? "" : String(after[id]);
      }
      return v;
    });
  };
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
    if (Object.keys(links).length)
      await onAction(
        "confirm",
        quantities,
        Object.fromEntries(Object.entries(links)),
      );
    else await onAction("confirm", quantities);
  };
  const picker = (line: SlipLine, index: number, label: string) => {
    const candidates = (line.candidates ?? []).filter((id) =>
      analysis.items.some((x) => x.id === id),
    );
    return (
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <select
          aria-label={`Order item for slip line ${index + 1}`}
          className="border-input bg-background h-9 max-w-full min-w-0 flex-1 rounded-md border px-2 text-sm"
          disabled={busy}
          value={linkOf(index) ?? ""}
          onChange={(e) => link(index, e.target.value || null)}
        >
          <option value="">Not on this order</option>
          {candidates.length > 0 && (
            <optgroup label="Likely matches">
              {candidates.map((id) => (
                <option key={id} value={id}>
                  {analysis.items.find((x) => x.id === id)!.description}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All order items">
            {analysis.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.description}
                {x.sku ? ` (${x.sku})` : ""}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
    );
  };
  const slipNumbers = (line: SlipLine) => (
    <p className="text-muted-foreground text-xs">
      Read from slip:{" "}
      {[
        line.ordered != null && `ordered ${line.ordered}`,
        `shipped ${line.shipped ?? "unclear"}`,
        line.backordered !== null && `backordered ${line.backordered}`,
      ]
        .filter(Boolean)
        .join(" · ")}
      {line.unit ? ` ${line.unit}` : ""}
    </p>
  );
  const messages = (line: SlipLine, linked: boolean) => (
    <>
      {openIssues(line, linked).map((issue) => (
        <p
          key={issue}
          className="flex gap-1.5 text-sm text-amber-800 dark:text-amber-300"
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          {issue}
        </p>
      ))}
      {(line.notes ?? []).map((note) => (
        <p key={note} className="text-muted-foreground flex gap-1.5 text-xs">
          <InfoIcon className="mt-0.5 size-3 shrink-0" />
          {note}
        </p>
      ))}
    </>
  );

  return (
    <section aria-label="Review delivery" className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">Review delivery</h3>
          <p className="text-muted-foreground text-xs">
            {analysis.lines.length} slip lines · {analysis.items.length} order
            items
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          Quantities are read from the slip. Count what arrived, correct
          anything that differs, then confirm. They add to previous receipts;
          blank fields stay unchanged.
        </p>
        {rows.length > 0 && (
          <div>
            <div
              className="bg-muted flex h-2 overflow-hidden rounded-full"
              aria-hidden
            >
              {(Object.keys(STATUS) as Status[]).map((s) => (
                <div
                  key={s}
                  className={cn("h-full", STATUS[s].bar)}
                  style={{ width: `${(counts[s] / rows.length) * 100}%` }}
                />
              ))}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {counts.complete} of {rows.length} order items complete after this
              delivery
              {counts.review ? ` · ${counts.review} to check` : ""}.
            </p>
          </div>
        )}
      </div>
      {analysis.warnings.map((warning, i) => (
        <p
          key={i}
          className="flex gap-1.5 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {warning}
        </p>
      ))}
      <div
        role="group"
        aria-label="Show order items"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {FILTERS.map(([f, label]) =>
          f !== "all" && !counts[f] ? null : (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                filter === f
                  ? "border-foreground bg-foreground text-background"
                  : "hover:bg-accent",
              )}
            >
              {label} <span className="opacity-70">{counts[f]}</span>
            </button>
          ),
        )}
      </div>
      <ul className="space-y-3">
        {visible.map(({ item, lines, value, n, suggested, total, status }) => {
          const mismatch =
            n !== undefined &&
            suggested !== undefined &&
            Math.abs(n - suggested) > 1e-6;
          const scale = Math.max(item.ordered, total, 1e-6);
          const confidence = lines.find(
            ({ line, index }) => !(index in links) && line.confidence,
          )?.line.confidence;
          return (
            <li
              key={item.id}
              className={cn(
                "space-y-3 rounded-lg border p-3 text-sm",
                status === "review" && "border-amber-300 dark:border-amber-800",
              )}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.description}</p>
                  <p className="text-muted-foreground text-xs">
                    {item.sku ? `SKU ${item.sku}` : "No SKU"}
                    {confidence && confidence !== "high"
                      ? ` · ${confidence}-confidence match`
                      : ""}
                    {lines.some(({ index }) => index in links)
                      ? " · matched by you"
                      : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                    STATUS[status].tone,
                  )}
                >
                  {status === "short"
                    ? `${fmt(item.ordered - total, item.unit)} outstanding`
                    : status === "over"
                      ? `Over by ${fmt(total - item.ordered, item.unit)}`
                      : STATUS[status].label}
                </span>
              </div>
              {lines.map(({ line, index }) => (
                <div key={index} className="space-y-1.5">
                  {printed(line, index)}
                  {slipNumbers(line)}
                  {messages(line, index in links)}
                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer">
                      Wrong item?
                    </summary>
                    <div className="pt-2">
                      {picker(line, index, "This slip line is")}
                    </div>
                  </details>
                </div>
              ))}
              {!lines.length && (
                <p className="text-muted-foreground text-xs">
                  Not found on this slip. Enter a quantity only if it arrived.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label="Ordered">{fmt(item.ordered, item.unit)}</Figure>
                <Figure label="Received before">
                  {fmt(item.received, item.unit)}
                </Figure>
                <label className="space-y-0.5">
                  <span className="text-muted-foreground block text-xs">
                    This delivery
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Input
                      aria-label={`Received this delivery: ${item.description}`}
                      type="number"
                      min="0"
                      max="999999"
                      step="any"
                      inputMode="decimal"
                      value={value}
                      placeholder={suggested === undefined ? "Count" : ""}
                      disabled={busy}
                      onChange={(e) => {
                        setChecked(false);
                        setValues((old) => ({
                          ...old,
                          [item.id]: e.target.value,
                        }));
                      }}
                      className="h-9 w-20"
                    />
                    <span className="text-xs">{item.unit}</span>
                  </span>
                </label>
                <Figure label="Outstanding after">
                  {fmt(Math.max(0, item.ordered - total), item.unit)}
                </Figure>
              </div>
              <div
                className="bg-muted flex h-1.5 overflow-hidden rounded-full"
                aria-hidden
              >
                <div
                  className="bg-foreground/50 h-full"
                  style={{
                    width: `${(Math.min(item.received, scale) / scale) * 100}%`,
                  }}
                />
                <div
                  className={cn(
                    "h-full",
                    status === "over" ? "bg-red-500" : "bg-emerald-500",
                  )}
                  style={{
                    width: `${(Math.max(0, total - item.received) / scale) * 100}%`,
                  }}
                />
              </div>
              {n !== undefined && (
                <p className="text-xs">
                  New received total: {round(item.received + n)} {item.unit}
                </p>
              )}
              {mismatch && (
                <p className="flex gap-1.5 text-amber-800 dark:text-amber-300">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                  Actual receipt differs from slip ({fmt(suggested, item.unit)}
                  ). The order item will be flagged.
                </p>
              )}
            </li>
          );
        })}
        {!visible.length && (
          <li className="text-muted-foreground text-sm">
            No order items in this group.
          </li>
        )}
      </ul>
      {extras.length > 0 && (
        <section
          aria-label="Slip lines not matched to the order"
          className="space-y-3"
        >
          <h4 className="text-sm font-semibold">
            On the slip but not matched ({extras.length})
          </h4>
          <p className="text-muted-foreground text-xs">
            Link a line to an order item if it is the same product. Leave it as
            “Not on this order” for substitutions or other orders.
          </p>
          <ul className="space-y-3">
            {extras.map(({ line, index }) => (
              <li
                key={index}
                className="space-y-1.5 rounded-lg border border-dashed p-3 text-sm"
              >
                {printed(line, index)}
                {slipNumbers(line)}
                {messages(line, false)}
                {picker(line, index, "Link to")}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="bg-background sticky -bottom-6 space-y-3 border-t pt-3 pb-1">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={checked}
            disabled={busy}
            onChange={(e) => setChecked(e.target.checked)}
          />{" "}
          I checked the physical delivery and reviewed the flagged differences.
        </label>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
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
      </div>
    </section>
  );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-medium tabular-nums">{children}</p>
    </div>
  );
}

function Applied({ analysis }: { analysis: SlipAnalysis }) {
  const applied = analysis.applied!;
  const proposed = suggestions(
    analysis,
    Object.fromEntries(
      Object.entries(applied.links ?? {}).map(([i, id]) => [Number(i), id]),
    ),
  );
  const linked = Object.keys(applied.links ?? {}).length;
  return (
    <details className="space-y-2" open>
      <summary
        className="flex cursor-pointer items-start gap-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        role="status"
      >
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" />
        <span>
          Receipt confirmed {new Date(applied.at).toLocaleString()}. This slip
          will not be counted again.
          {linked
            ? ` ${linked} slip ${linked === 1 ? "line was" : "lines were"} matched by hand.`
            : ""}
        </span>
      </summary>
      <ul className="divide-y rounded-lg border text-sm">
        {analysis.items.map((item) => {
          const confirmed = applied.quantities[item.id];
          const slip = proposed[item.id];
          const differs =
            confirmed !== undefined &&
            slip !== undefined &&
            Math.abs(confirmed - slip) > 1e-6;
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 p-2"
            >
              <span className="min-w-0 flex-1 font-medium">
                {item.description}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">
                Slip {slip === undefined ? "unclear" : fmt(slip, item.unit)} ·
                Confirmed{" "}
                {confirmed === undefined
                  ? "not changed"
                  : fmt(confirmed, item.unit)}
              </span>
              {differs && (
                <span className="w-full text-xs text-amber-800 dark:text-amber-300">
                  ⚠ Delivery differs from the slip.
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
