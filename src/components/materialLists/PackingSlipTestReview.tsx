"use client";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { SlipLineImage } from "./SlipLineImage";
import { useDevFeatures } from "~/components/app/DevFeaturesProvider";
import { DevBadge } from "~/components/app/DevBadge";
import {
  slipTestReviewSchema,
  type SlipTestReview,
} from "~/lib/packing-slip-test-review";
export function PackingSlipTestReview(props: {
  jobId: string;
  versionId: string;
}) {
  return useDevFeatures() ? <DevTestReview {...props} /> : null;
}
function DevTestReview({
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
        {open ? "Hide" : "Open"} Jev test review <DevBadge />
      </Button>
      {open && (
        <>
          <p className="text-muted-foreground text-sm">
            Dev · {review.model}. Original test answers, including
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
              <div
                className={
                  row.dewarped
                    ? "grid grid-cols-1 gap-4 lg:grid-cols-2"
                    : "space-y-2"
                }
              >
                {(
                  ["original", ...(row.dewarped ? ["dewarped"] : [])] as const
                ).map((mode) => {
                  const after = mode === "dewarped";
                  const answers = after ? row.dewarped! : row;
                  const imageUrl = after
                    ? `/api/job-documents/packing-slips/test-review?jobId=${encodeURIComponent(jobId)}&versionId=${encodeURIComponent(versionId)}&page=${row.page}`
                    : url;
                  return (
                    <section
                      key={mode}
                      className="min-w-0 space-y-3 rounded border p-3"
                      aria-label={after ? "After dewarping" : "Original scan"}
                    >
                      <h5 className="font-medium">
                        {after ? "After dewarping" : "Original scan"}
                      </h5>
                      <SlipLineImage
                        url={imageUrl}
                        page={after ? 1 : row.page}
                        box={row.box}
                        header={
                          row.header
                            ? { page: after ? 1 : row.page, box: row.header }
                            : undefined
                        }
                        label={`${after ? "Dewarped" : "Original"} page ${row.page}, detected row ${row.index}`}
                      />
                      <dl className="space-y-2 text-sm">
                        {(
                          [
                            ["Part", "part"],
                            ["Shipped", "shipped"],
                            ["Backordered", "backordered"],
                          ] as const
                        ).map(([label, key]) => {
                          const answer = answers[key];
                          const delta = Math.round(
                            (answer.confidence - row[key].confidence) * 100,
                          );
                          return (
                            <div key={key}>
                              <dt className="font-medium">{label}</dt>
                              <dd>
                                {answer.value} ·{" "}
                                {Math.round(answer.confidence * 100)}%
                                confidence
                                {after
                                  ? ` · ${delta > 0 ? "+" : ""}${delta} percentage points`
                                  : ""}
                                {answer.confidence < 0.8
                                  ? " · Needs human review"
                                  : ""}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    </section>
                  );
                })}
              </div>
              <p className="text-muted-foreground text-xs">
                Original row location confidence:{" "}
                {Math.round(row.locationConfidence * 100)}%.{" "}
                {row.kind.value !== "one"
                  ? "Possible multiple items or non-item row—review the image. "
                  : ""}
                Confidence changes do not establish accuracy. Row locations and
                questions were held fixed.
              </p>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
