"use client";
import { useEffect, useState } from "react";
import { EyeIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  comparisonDates,
  type OrderMatchComparison,
} from "~/lib/order-match-comparison";

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
  }, [jobId, documentId, orderId, requestKey]);
  const dates = data && comparisonDates(data.orderDate, data.slipDate);
  return (
    <section aria-label="Order and slip comparison" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Order / Slip Comparison</p>
        <Button variant="outline" size="sm" asChild>
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            <EyeIcon />
            View Slip
          </a>
        </Button>
      </div>
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
                <col className="w-[32%]" />
                <col className="w-[18%]" />
                <col className="w-[32%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="bg-muted/60">
                <tr>
                  {[
                    "Order Description",
                    "Order Qty",
                    "Slip Description",
                    "Slip Qty",
                  ].map((heading, index) => (
                    <th
                      key={heading}
                      scope="col"
                      className={`p-2 text-left align-top font-medium ${index === 2 ? "border-l" : ""}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr key={index} className="border-t align-top">
                    <td className="p-2 break-words">
                      {row.order?.description ?? (
                        <span className="text-muted-foreground">
                          No clear match
                        </span>
                      )}
                    </td>
                    <td className="p-2 break-words tabular-nums">
                      {row.order ? (
                        <>
                          {row.order.quantity} {row.order.unit}
                          {row.order.piecesPerPack &&
                          row.order.piecesPerPack > 1 ? (
                            <span className="text-muted-foreground block text-xs">
                              {row.order.piecesPerPack} per {row.order.unit}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="border-l p-2 break-words">
                      {row.slip?.description ?? (
                        <span className="text-muted-foreground">
                          No matched slip line
                        </span>
                      )}
                    </td>
                    <td className="p-2 break-words tabular-nums">
                      {row.slip ? (
                        <>
                          {row.slip.quantity ?? "Unread"} {row.slip.unit}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <p className="text-muted-foreground p-3 text-sm">
                No saved lines available yet.
              </p>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Quick order comparison. Check and edit individual lines in the next
            step.
          </p>
        </>
      )}
    </section>
  );
}
