import type * as ChildProcess from "node:child_process";
// @vitest-environment node
import { afterAll, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";
const root = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const root = mkdtempSync(path.join(tmpdir(), "extraction-test-"));
  process.env.JOB_DOCUMENT_STORAGE_ROOT = root;
  return root;
});
vi.mock("node:child_process",async original=>{
  const actual=await original<typeof ChildProcess>();
  return {...actual,spawn:vi.fn(actual.spawn)};
});
import {spawn} from "node:child_process";
import { writeDocumentBlob } from "../documents/storage";
import { extractSpecification } from "./extract";
import { extractionSession } from "./extract-session";
import type { AssessmentSource } from "./types";
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it("reuses one PDF across batches, recycles, and reuses tenant/source-specific evidence", async () => {
  const org = crypto.randomUUID();
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 72; page++)
    doc
      .addPage([612, 792])
      .drawText(
        `Page ${page}: Copper piping through two inches. Larger piping uses carbon steel. Valve and joining requirements remain unchanged.`,
        { font, size: 10, x: 10, y: 700, maxWidth: 580 },
      );
  const sha256 = await writeDocumentBlob(org, await doc.save());
  const source: AssessmentSource = {
    documentId: crypto.randomUUID(),
    versionId: crypto.randomUUID(),
    name: "Spec",
    fileName: "spec.pdf",
    mimeType: "application/pdf",
    sha256,
  };
  const session = extractionSession(org, source);
  const pages = [];
  try {
    for (let start = 1; start <= 72; start += 8)
      pages.push(...(await session.read(start)).pages);
  } finally {
    await session.close();
  }
  expect(pages).toHaveLength(72);
  console.info("Extraction worker stats", session.stats());
  expect(spawn).toHaveBeenCalledTimes(2);
  expect(pages.map((page) => page.page)).toEqual(
    Array.from({ length: 72 }, (_, i) => i + 1),
  );
  const progress = vi.fn(async () => undefined),
    checkpointRoot = mkdtempSync(path.join(tmpdir(), "extract-run-"));
  try {
    const first = await extractSpecification(org, source, {
      checkpointRoot,
      progress,
    });
    expect(first.pages).toEqual(pages);
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(first.warnings).toEqual([]);
    expect(progress).toHaveBeenCalledTimes(9);
    // Remove source: a second authorized call can use immutable cached evidence;
    // a changed hash or company cannot accidentally reuse that evidence.
    await rm(path.join(root, org, sha256.slice(0, 2), sha256));
    expect(await extractSpecification(org, source)).toEqual(first);
    expect(spawn).toHaveBeenCalledTimes(4);
    await expect(
      extractSpecification(crypto.randomUUID(), source),
    ).rejects.toThrow();
    await expect(
      extractSpecification(org, { ...source, sha256: "a".repeat(64) }),
    ).rejects.toThrow();
  } finally {
    await rm(checkpointRoot, { recursive: true, force: true });
  }
}, 30_000);
