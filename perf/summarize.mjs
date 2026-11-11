import fs from "node:fs";
const reports = process.argv.slice(2);
if (!reports.length)
  throw new Error("Usage: node perf/summarize.mjs report.json [repeat.json]");
const groups = new Map();
for (const file of reports) {
  const report = JSON.parse(fs.readFileSync(file));
  for (const sample of report.samples ?? []) {
    for (const metric of [
      { name: "automation-wallclock", durationMs: sample.durationMs },
      ...(sample.browserMeasures ?? []),
    ]) {
      if (!Number.isFinite(metric.durationMs)) continue;
      const key = JSON.stringify({
        build: report.build,
        journey: sample.journey,
        link: sample.link,
        metric: metric.name,
      });
      const values = groups.get(key) ?? [];
      values.push(metric.durationMs);
      groups.set(key, values);
    }
  }
}
const rows = [...groups].map(([key, values]) => {
  values.sort((a, b) => a - b);
  const p = (q) => values[Math.max(0, Math.ceil(q * values.length) - 1)];
  return {
    ...JSON.parse(key),
    count: values.length,
    medianMs: p(0.5),
    p95Ms: p(0.95),
  };
});
console.log(
  JSON.stringify(
    {
      method:
        "Nearest-rank percentiles. Five samples give a descriptive p95 equal to the maximum; this is not a statistically established p95. Browser custom measures are RAF paint-opportunity proxies; automation wallclock includes Playwright/assertion overhead. No physical Pixel measurements.",
      rows,
    },
    null,
    2,
  ),
);
