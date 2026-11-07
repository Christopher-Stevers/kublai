/** Prepare private comparison images without modifying original scans or answers.
 * Usage: npx tsx scripts/bench/prepare-slip-dewarp.ts review-directory org-id job-id */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import dotenv from "dotenv";
import { z } from "zod";
import { tsvWords } from "../../src/server/packing-slips/ocr-rows";
import {
  estimatePageWarp,
  dewarpPage,
} from "../../src/server/packing-slips/dewarp";
import { slipTestReviewSchema } from "../../src/lib/packing-slip-test-review";
const [source, org, job] = process.argv.slice(2);
if (!source) throw Error("Review directory required");
const organizationId = z.uuid().parse(org),
  jobId = z.uuid().parse(job);
const env = dotenv.parse(await fs.readFile(".env"));
const manifest = JSON.parse(
  await fs.readFile(path.join(source, "manifest.json"), "utf8"),
) as { versionId: string };
const versionId = z.uuid().parse(manifest.versionId);
const root = path.join(
  env.JOB_DOCUMENT_STORAGE_ROOT ?? "uploads/job-documents",
  "packing-slip-tests",
  organizationId,
  jobId,
);
const target = path.join(root, versionId + ".json");
const review = slipTestReviewSchema.parse(
  JSON.parse(await fs.readFile(target, "utf8")),
);
const preparedPages: number[] = [];
for (const page of [...new Set(review.rows.map((r) => r.page))]) {
  const png = await fs.readFile(path.join(source, `page-${page}.png`));
  const meta = await sharp(png).metadata();
  const text = execFileSync(
    "tesseract",
    ["stdin", "stdout", "--psm", "11", "tsv"],
    {
      input: png,
      encoding: "utf8",
      timeout: 25000,
      maxBuffer: 8e6,
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  const warp = estimatePageWarp(tsvWords(text, meta.width!, meta.height!));
  if (!warp) {
    console.log(
      `Page ${page}: kept original (insufficient consistent curvature)`,
    );
    continue;
  }
  const output = await dewarpPage(png, warp);
  await fs.writeFile(path.join(root, `${versionId}-page-${page}.png`), output, {
    mode: 0o600,
  });
  await fs.writeFile(
    path.join(source, `page-${page}.warp.json`),
    JSON.stringify(warp),
    { mode: 0o600 },
  );
  preparedPages.push(page);
  console.log(
    `Page ${page}: prepared using ${warp.anchors.length} consistent baselines`,
  );
}
await fs.writeFile(
  target + ".tmp",
  JSON.stringify({ ...review, preparedPages }),
  { mode: 0o600 },
);
await fs.rename(target + ".tmp", target);
