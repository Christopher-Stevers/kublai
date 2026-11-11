import fs from "node:fs";
// Consume daily anonymous JSONL files, never application logs containing content.
const files = process.argv.slice(2);
if (!files.length)
  throw new Error(
    "Usage: node perf/field-report.mjs data/perf/YYYY-MM-DD.jsonl [...]",
  );
const groups = new Map();
for (const file of files)
  for (const line of fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.version !== 1 || !Array.isArray(row.metrics))
      throw new Error(`Invalid telemetry record in ${file}`);
    for (const metric of row.metrics) {
      if (!Number.isFinite(metric.durationMs)) continue;
      const key = JSON.stringify({
        build: row.build,
        screen: row.screen,
        device: row.device,
        link: row.link,
        metric: metric.name,
      });
      const values = groups.get(key) ?? [];
      values.push(metric.durationMs);
      groups.set(key, values);
    }
  }
const rows = [...groups].map(([key, values]) => {
  values.sort((a, b) => a - b);
  const p = (q) =>
    values[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)];
  const tags = JSON.parse(key);
  return {
    ...tags,
    count: values.length,
    p75Ms: p(0.75),
    p95Ms: p(0.95),
    targetFlag:
      tags.metric === "inp" && p(0.75) >= 50 ? "INP p75 target exceeded" : null,
  };
});
console.log(
  JSON.stringify(
    {
      source: "field-beacons",
      limitations:
        "Viewport class is not verified physical phone hardware; absent metrics are unknown, never zero.",
      rows,
    },
    null,
    2,
  ),
);
