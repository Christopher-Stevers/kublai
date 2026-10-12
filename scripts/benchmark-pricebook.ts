import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { scanEstimatePricing } from "./benchmarks/scan-pricing";
import { matchEstimatePricing } from "../src/lib/estimating/pricing";
import { exportPricingCsv, importPricingCsv } from "../src/lib/estimating/csv";
import { newEstimateLine, pricingRowSchema } from "../src/lib/estimating/types";

const [engine, output, repeatArg = "3"] = process.argv.slice(2);
const repeats = Number(repeatArg);
if (
  !["scan", "indexed"].includes(engine ?? "") ||
  !output ||
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  repeats > 10
)
  throw Error(
    "Usage: benchmark-pricebook.ts scan|indexed report.json [repeats]",
  );
const matcher = engine === "scan" ? scanEstimatePricing : matchEstimatePricing;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const cases = [];
for (const [lineCount, rowCount] of [
  [100, 1000],
  [500, 5000],
  [2000, 10000],
] as const) {
  const rows = Array.from({ length: rowCount }, (_, i) =>
    pricingRowSchema.parse({
      id: `price-${i}`,
      description: `Copper pipe fitting ${i}`,
      sku: `CU-${i}`,
      unit: "lf",
      currency: "CAD",
      supplierName: "Benchmark Supply",
      materialUnitCost: (i % 1000) / 100,
      laborHoursPerUnit: 0.08,
      orderMultiple: 10,
      priceSource: i % 7 ? "supplier" : "simulated",
    }),
  );
  const lines = Array.from({ length: lineCount }, (_, i) => {
    const row = (i * 7) % rowCount;
    return newEstimateLine({
      id: `line-${i}`,
      description: i % 5 ? ` COPPER   PIPE FITTING ${row} ` : `CU-${row}`,
      quantity: 10 + i,
      unit: "ft",
      supplierName: "benchmark supply",
      priceCurrency: "CAD",
    });
  });
  const durations = [];
  let resultHash = "";
  for (let i = 0; i <= repeats; i++) {
    const start = performance.now();
    const result = matcher(lines, rows, { currency: "CAD" });
    const elapsed = performance.now() - start;
    const nextHash = hash(result);
    if (resultHash && nextHash !== resultHash) throw Error("Unstable result");
    resultHash = nextHash;
    if (i) durations.push(elapsed);
  }
  const csv = exportPricingCsv(rows);
  const csvDurations = [];
  let csvHash = "";
  for (let i = 0; i <= repeats; i++) {
    const start = performance.now();
    const imported = importPricingCsv(csv);
    const elapsed = performance.now() - start;
    if (imported.errors.length) throw Error("Benchmark CSV is invalid");
    const nextHash = hash(imported);
    if (csvHash && csvHash !== nextHash) throw Error("Unstable CSV result");
    csvHash = nextHash;
    if (i) csvDurations.push(elapsed);
  }
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const result = {
    lineCount,
    rowCount,
    durationsMs: durations,
    medianMs: median(durations),
    resultSha256: resultHash,
    csvBytes: Buffer.byteLength(csv),
    csvDurationsMs: csvDurations,
    csvMedianMs: median(csvDurations),
    csvSha256: csvHash,
  };
  cases.push(result);
  console.log(JSON.stringify({ engine, ...result }));
}
await writeFile(
  output,
  JSON.stringify(
    {
      engine,
      fixture: "synthetic supplier rows; current application limits",
      node: process.version,
      cases,
    },
    null,
    2,
  ),
);
