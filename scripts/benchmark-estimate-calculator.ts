import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { calculateEstimate } from "../src/lib/estimating/calculator";
import {
  estimateDocumentSchema,
  newEstimateLine,
} from "../src/lib/estimating/types";
import { scanCalculateEstimate } from "./benchmarks/scan-calculator";

const [engine, output] = process.argv.slice(2);
if (!output || !["scan", "optimized"].includes(engine ?? ""))
  throw Error(
    "Usage: benchmark-estimate-calculator.ts scan|optimized report.json",
  );
const calculate = engine === "scan" ? scanCalculateEstimate : calculateEstimate;
const cases = [];
for (const [lineCount, alternateCount] of [
  [100, 0],
  [500, 10],
  [2000, 20],
]) {
  const document = estimateDocumentSchema.parse({
    alternates: Array.from({ length: alternateCount! }, (_, i) => ({
      id: `alt-${i}`,
      name: `Option ${i}`,
      included: i % 2 === 0,
    })),
    lines: Array.from({ length: lineCount! }, (_, i) =>
      newEstimateLine({
        id: `line-${i}`,
        description: `Benchmark pipe ${i % 25}`,
        quantity: 1 + (i % 17) / 10,
        unit: "ft",
        multiplier: 2,
        wastePercent: 5,
        orderMultiple: 10,
        partDefinitionId: `part-${i % 25}`,
        supplierName: "QA Supply",
        materialUnitCost: 3.25,
        laborHoursPerUnit: 0.13,
        priceSource: "simulated",
        trade: `Trade ${i % 4}`,
        area: `Level ${i % 10}`,
        costCode: `Cost ${i % 8}`,
        source: {
          kind: "drawing-measurement",
          sheetId: "sheet",
          markupId: `mark-${i}`,
          confidence: 0.6,
        },
        ...(alternateCount && i % 3
          ? { alternateId: `alt-${i % alternateCount}` }
          : {}),
      }),
    ),
  });
  const times = [];
  let resultSha256 = "";
  for (let i = 0; i < 4; i++) {
    const start = performance.now();
    const result = calculate(document, {
      now: new Date("2026-10-12T00:00:00Z"),
    });
    const elapsed = performance.now() - start;
    const digest = createHash("sha256")
      .update(JSON.stringify(result))
      .digest("hex");
    if (resultSha256 && digest !== resultSha256)
      throw Error("Unstable calculator result");
    resultSha256 = digest;
    if (i) times.push(elapsed);
  }
  const result = {
    lineCount,
    alternateCount,
    timesMs: times,
    medianMs: [...times].sort((a, b) => a - b)[1],
    resultSha256,
  };
  cases.push(result);
  console.log(JSON.stringify({ engine, ...result }));
}
await writeFile(
  output,
  JSON.stringify({ engine, synthetic: true, cases }, null, 2) + "\n",
);
