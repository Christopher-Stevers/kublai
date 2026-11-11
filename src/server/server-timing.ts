import { withQueryStats } from "./db/query-stats";

/**
 * Timings stop when response headers are ready; streaming continues unchanged.
 * Summed database waits may exceed elapsed time when queries run concurrently.
 */
export async function withServerTiming(run: () => Promise<Response>) {
  const start = performance.now();
  const { result, stats } = await withQueryStats(run);
  const streaming = result.headers.get("content-type")?.includes("jsonl");
  const description = streaming ? ';desc="before stream headers"' : "";
  result.headers.append(
    "Server-Timing",
    [
      `db;dur=${stats.databaseMs.toFixed(1)}${description}`,
      `app;dur=${(performance.now() - start).toFixed(1)}${description}`,
    ].join(", "),
  );
  return result;
}
