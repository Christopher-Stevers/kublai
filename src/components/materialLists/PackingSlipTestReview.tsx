"use client";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { SlipLineImage } from "./SlipLineImage";
import {
  slipTestReviewSchema,
  type SlipTestReview,
} from "~/lib/packing-slip-test-review";
export function PackingSlipTestReview({
  jobId,
  versionId,
}: {
  jobId: string;
  versionId: string;
}) {
  const [review, setReview] = useState<SlipTestReview | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/job-documents/packing-slips/test-review?jobId=${encodeURIComponent(jobId)}&versionId=${encodeURIComponent(versionId)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) throw Error();
        const data = (await response.json()) as { review: unknown };
        if (!controller.signal.aborted)
          setReview(
            data.review ? slipTestReviewSchema.parse(data.review) : null,
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [jobId, versionId, attempt]);
  if (error)
    return (
      <Button
        variant="outline"
        onClick={() => {
          setError(false);
          setAttempt((n) => n + 1);
        }}
      >
        Retry loading Jev test review
      </Button>
    );
  if (!review) return null;
  const url = `/api/job-documents/files/${versionId}?jobId=${encodeURIComponent(jobId)}`;
  return (
    <section className="space-y-3">
      <Button
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide" : "Open"} Jev test review
      </Button>
      {open && (
        <>
          <p className="text-muted-foreground text-sm">
            Experimental · {review.model}. Original test answers, including
            mistakes. This review does not record receipts. Below 80% requires
            human review; higher scores do not guarantee correctness.
          </p>
          <a
            className="text-sm underline"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Open full packing slip to check missed or split rows
          </a>
          {!!review.preparedPages?.length && (
            <div className="space-y-2 rounded border p-3 text-sm">
              <p>
                Dewarped comparison images are ready. Original scores are
                preserved; rerun scores appear below where available.
              </p>
              {review.preparedPages.map((page) => (
                <a
                  key={page}
                  className="block underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`/api/job-documents/packing-slips/test-review?jobId=${encodeURIComponent(jobId)}&versionId=${encodeURIComponent(versionId)}&page=${page}`}
                >
                  View dewarped page {page}
                </a>
              ))}
            </div>
          )}
          {review.rows.map((row) => (
            <article
              key={`${row.page}:${row.index}`}
              className="space-y-2 rounded border p-3"
            >
              <h4 className="font-medium">
                Page {row.page} · detected row {row.index}
              </h4>
              <SlipLineImage
                url={url}
                page={row.page}
                box={row.box}
                header={
                  row.header ? { page: row.page, box: row.header } : undefined
                }
                label={`Page ${row.page}, detected row ${row.index}`}
              />
              <p className="text-muted-foreground text-xs">
                Row location confidence:{" "}
                {Math.round(row.locationConfidence * 100)}%.{" "}
                {row.kind.value !== "one"
                  ? "Possible multiple items or non-item row—review the image."
                  : ""}
              </p>
              <dl className="space-y-2 text-sm">
                {(
                  [
                    ["Part", row.part],
                    ["Shipped", row.shipped],
                    ["Backordered", row.backordered],
                  ] as const
                ).map(([label, answer]) => (
                  <div key={label}>
                    <dt className="font-medium">{label}</dt>
                    <dd>
                      {answer.value} · {Math.round(answer.confidence * 100)}%
                      confidence
                      {answer.confidence < 0.8 ? " · Needs human review" : ""}
                    </dd>
                  </div>
                ))}
              </dl>
              {row.dewarped && (
                <div className="space-y-2 border-t pt-2 text-sm">
                  <h5 className="font-medium">
                    After dewarping · same row and questions
                  </h5>
                  {(
                    [
                      ["Part", "part"],
                      ["Shipped", "shipped"],
                      ["Backordered", "backordered"],
                    ] as const
                  ).map(([label, key]) => {
                    const before = row[key],
                      after = row.dewarped![key];
                    const delta = Math.round(
                      (after.confidence - before.confidence) * 100,
                    );
                    return (
                      <p key={key}>
                        <strong>{label}:</strong> {before.value} (
                        {Math.round(before.confidence * 100)}%) → {after.value}{" "}
                        ({Math.round(after.confidence * 100)}%) ·{" "}
                        {delta > 0 ? "+" : ""}
                        {delta} percentage points
                        {after.confidence < 0.8 ? " · Needs human review" : ""}
                      </p>
                    );
                  })}
                  <p className="text-muted-foreground text-xs">
                    Confidence changes do not establish accuracy. Row locations
                    were held fixed for this comparison.
                  </p>
                </div>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
