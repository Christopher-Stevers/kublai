"use client";
import { useEffect, useId, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChevronDownIcon, EyeIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { createAccountPreference } from "~/hooks/create-account-preference";
import {
  comparisonDates,
  type OrderMatchComparison,
} from "~/lib/order-match-comparison";

type Shown = "open" | "closed";
/** The matching details stay open or folded as each person last left them. */
const useDetails = createAccountPreference<Shown>({
  keyFor: (account) => `foremanhq:slip-match-details:${account}`,
  valid: (value): value is Shown => value === "open" || value === "closed",
  initial: "closed",
});

export function OrderMatchPreview({
  jobId,
  documentId,
  orderId,
  readingKey,
  sourceUrl,
}: {
  jobId: string;
  documentId: string;
  orderId: string;
  readingKey: string;
  sourceUrl: string;
}) {
  const [result, setResult] = useState<{
    key: string;
    data: OrderMatchComparison | null;
    error: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [shown, setShown] = useDetails(useAuth().userId ?? undefined),
    open = shown === "open",
    panel = useId();
  const requestKey = JSON.stringify([
    jobId,
    documentId,
    orderId,
    readingKey,
    retry,
  ]);
  const current = result?.key === requestKey ? result : null;
  const data = current?.data;
  const error = current?.error;
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void fetch(
      `/api/job-documents/packing-slips/queue?${new URLSearchParams({ jobId, documentId, compareOrderId: orderId })}`,
      { cache: "no-store", signal: abort.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw Error("Comparison unavailable");
        const result = (await response.json()) as OrderMatchComparison;
        if (!Array.isArray(result.rows) || result.orderId !== orderId)
          throw Error("Comparison unavailable");
        if (!abort.signal.aborted)
          setResult({ key: requestKey, data: result, error: false });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setResult({ key: requestKey, data: null, error: true });
      });
    return () => abort.abort();
  }, [jobId, documentId, orderId, requestKey, open]);
  const dates = data && comparisonDates(data.orderDate, data.slipDate);
  return (
    <section aria-label="Order and slip comparison" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setShown(open ? "closed" : "open")}
          className="flex items-center gap-1.5 py-1 text-sm font-medium"
        >
          Matching details
          <ChevronDownIcon
            className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
        <Button variant="outline" size="sm" asChild>
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            <EyeIcon />
            View Slip
          </a>
        </Button>
      </div>
      {open && (
        <div id={panel} className="space-y-3">
          {error ? (
            <div role="status" className="text-muted-foreground text-sm">
              Comparison unavailable.{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRetry((value) => value + 1)}
              >
                Try Again
              </Button>
            </div>
          ) : !data || !dates ? (
            <p role="status" className="text-muted-foreground text-sm">
              Loading saved comparison…
            </p>
          ) : (
            <>
              <div
                className={`flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md px-3 py-2 text-sm ${dates.close ? "bg-sky-100 text-sky-950 dark:bg-sky-500/15 dark:text-sky-200" : "bg-muted text-muted-foreground"}`}
              >
                <span>
                  Order Sent: <strong>{dates.order}</strong>
                </span>
                <span>
                  Slip Date: <strong>{dates.slip}</strong>
                </span>
                {dates.label && (
                  <span className="font-semibold">{dates.label}</span>
                )}
              </div>
              <div className="overflow-hidden rounded-md border">
                <table
                  className="w-full table-fixed text-xs sm:text-sm"
                  aria-label="Order and slip quantities"
                >
                  <colgroup>
                    <col className="w-[29%]" />
                    <col className="w-[14%]" />
                    <col className="w-[14%]" />
                    <col className="w-[29%]" />
                    <col className="w-[14%]" />
                  </colgroup>
                  <thead className="bg-muted/60">
                    <tr>
                      {[
                        "Order Description",
                        "Order Qty",
                        "Match",
                        "Slip Description",
                        "Slip Qty",
                      ].map((heading, index) => (
                        <th
                          key={heading}
                          scope="col"
                          className={`px-1 py-2 align-top font-medium sm:px-2 ${index === 2 ? "text-center" : "text-left"}`}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, index) => {
                      const score = Number.isFinite(row.matchScore)
                        ? Math.round(Math.max(0, Math.min(100, row.matchScore)))
                        : null;
                      const hue = score === null ? null : score * 1.2;
                      return (
                        <tr
                          key={index}
                          className="border-t align-top"
                          style={
                            hue === null
                              ? undefined
                              : {
                                  backgroundColor: `hsl(${hue} 75% 40% / 0.12)`,
                                }
                          }
                        >
                          <td className="px-1 py-2 break-words sm:px-2">
                            {row.order?.description ?? (
                              <span className="text-muted-foreground">
                                No clear match
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-2 break-words tabular-nums sm:px-2">
                            {row.order ? (
                              <>
                                {row.order.quantity} {row.order.unit}
                                {row.order.piecesPerPack &&
                                row.order.piecesPerPack > 1 ? (
                                  <span className="text-muted-foreground block text-xs">
                                    {row.order.piecesPerPack} per{" "}
                                    {row.order.unit}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-0.5 py-2 text-center align-middle">
                            <span
                              className="inline-flex size-9 items-center justify-center rounded-full border border-white/20 text-xs font-semibold text-white tabular-nums shadow-sm sm:size-10"
                              style={{
                                backgroundColor:
                                  hue === null
                                    ? "#52525b"
                                    : `hsl(${hue} 75% 28%)`,
                              }}
                              aria-label={
                                score === null
                                  ? "Match score unavailable"
                                  : `Product match score: ${score} out of 100`
                              }
                              title="Product similarity from saved text and codes; not a probability or quantity check."
                            >
                              {score ?? "—"}
                            </span>
                          </td>
                          <td className="px-1 py-2 break-words sm:px-2">
                            {row.slip?.description ?? (
                              <span className="text-muted-foreground">
                                No matched slip line
                              </span>
                            )}
                          </td>
                          <td className="px-1 py-2 break-words tabular-nums sm:px-2">
                            {row.slip ? (
                              <>
                                {row.slip.quantity ?? "Unread"} {row.slip.unit}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!data.rows.length && (
                  <p className="text-muted-foreground p-3 text-sm">
                    No saved lines available yet.
                  </p>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Match scores: 0 (deep red) to 100 (green). These estimate
                product similarity, not accuracy or quantity agreement. Check
                and edit individual lines in the next step.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
