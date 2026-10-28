/** Offline validation/import into an exported comparison bundle; never writes
 * the app database. Usage: tsx scripts/import-packing-slip-reference.ts <bundle> <response.json>
 * Response: {caseId,inputSha256,model,reasoningEffort,startedAt,completedAt,usage,output}
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  digest,
  immutableJson,
} from "../src/server/packing-slips/detection-record";
import {
  validateFallback,
  terraUsage,
  type FallbackInput,
} from "../src/server/packing-slips/terra-fallback";
const [bundle, file] = process.argv.slice(2);
if (!bundle || !file)
  throw Error("Supply export bundle and external response file.");
const response = z
  .object({
    caseId: z.string().regex(/^[a-f0-9-]{73}$/),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    model: z.string().regex(/^gpt-6\.1-terra(?:-|$)/),
    reasoningEffort: z.string().min(1),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    usage: z.unknown(),
    output: z.unknown(),
  })
  .parse(JSON.parse(await readFile(file, "utf8")));
const manifest = JSON.parse(
  await readFile(path.join(bundle, "manifest.json"), "utf8"),
) as { tasks: Array<{ caseId: string; inputSha256: string }> };
if (
  !manifest.tasks.some(
    (t) =>
      t.caseId === response.caseId && t.inputSha256 === response.inputSha256,
  )
)
  throw Error("Response is outside this export.");
const input = JSON.parse(
  await readFile(
    path.join(bundle, "reference-inputs", `${response.caseId}.json`),
    "utf8",
  ),
) as FallbackInput & {
  pages: Array<{ page: number; sha256: string; file: string }>;
};
if (digest(JSON.stringify(input)) !== response.inputSha256)
  throw Error("Reference inputs changed.");
for (const p of input.pages) {
  if (
    p.file !== `assets/${p.sha256}.png` ||
    digest(await readFile(path.join(bundle, p.file))) !== p.sha256
  )
    throw Error("Page evidence mismatch.");
}
const output = validateFallback(response.output, input, input.pages.length);
const record = {
  ...response,
  output,
  rawOutput: response.output,
  usageEstimate: terraUsage(response.usage),
  pricingAsOf: "2026-10-27",
  mode: "blind-reference",
  humanVerified: false,
};
if (!process.argv.includes("--validate-only"))
  await immutableJson(
    path.join(
      bundle,
      "external-results",
      `${response.caseId}-${digest(JSON.stringify(record))}.json`,
    ),
    record,
  );
console.log(
  JSON.stringify({
    caseId: response.caseId,
    lines: output.lines.length,
    validated: true,
    changedReceipts: false,
  }),
);
