import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, copyFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { validateJobFloorPlanPdf } from "./storage";
import { appendChunk, CHUNK_BYTES, createUpload, sessionDir } from "./upload-session";
import { validateDrawingPageCount, DRAWING_WORKER_SECONDS, DRAWING_POLL_MS } from "../../lib/drawing-upload-limits";
import { renderUploadPdf } from "./upload-render";
function pdf(pages: number, size = 100) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(" ")}] /Count ${pages} >>`,
    ...Array.from(
      { length: pages },
      () =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size} ${size}] /Resources << >> >>`,
    ),
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets.slice(1))
    text += `${String(o).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return text;
}
test("renderer rejects non-PDF and over-100-page inputs; clamps huge page canvas", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "upload-render-test-"));
  try {
    await writeFile(path.join(dir, "plan.pdf"), "not PDF");
    await assert.rejects(renderUploadPdf(dir, "job", "upload"), /not a PDF/);
    await writeFile(path.join(dir, "plan.pdf"), pdf(101));
    await assert.rejects(
      renderUploadPdf(dir, "job", "upload"),
      /more than 100 pages/,
    );
    await writeFile(path.join(dir, "plan.pdf"), pdf(1, 1_000_000));
    const sheets = await renderUploadPdf(dir, "job", "upload");
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0]?.width, 2200);
    assert.equal(sheets[0]?.height, 2200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("100-page synthetic PDF survives chunk staging and bounded sequential rendering", async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(path.join(os.tmpdir(), "upload-100-test-"));
  process.chdir(dir);
  try {
    assert.equal(validateJobFloorPlanPdf({ name: "test.pdf", type: "application/pdf", size: 100 * 1024 * 1024 } as File), null);
    assert.match(validateJobFloorPlanPdf({ name: "test.pdf", type: "application/pdf", size: 100 * 1024 * 1024 + 1 } as File)!, /100 MB/);
    validateDrawingPageCount(100);
    assert.throws(() => validateDrawingPageCount(101), /more than 100 pages/);
    assert.equal(DRAWING_WORKER_SECONDS, 600);
    assert.ok(DRAWING_POLL_MS > (DRAWING_WORKER_SECONDS + 15) * 1000);
    // Full-size canvases and >5 MB input exercise two real protocol chunks.
    const bytes = Buffer.from(pdf(100, 1100) + "\n%" + " ".repeat(CHUNK_BYTES));
    const session = await createUpload({ jobId: "0391aed4-7773-47ec-9141-09df373ec008", filename: "100.pdf", size: bytes.length }, { userId: "fixture", organizationId: "fixture" });
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES)
      await appendChunk(session.id, offset, bytes.subarray(offset, offset + CHUNK_BYTES));
    await copyFile(path.join(sessionDir(session.id), "upload.pdf"), path.join(dir, "plan.pdf"));
    const started = Date.now();
    const sheets = await renderUploadPdf(dir, session.jobId, session.id);
    assert.equal(sheets.length, 100);
    assert.equal((await readdir(dir)).filter(n => /^floor-.*webp$/.test(n)).length, 100);
    for (let i = 0; i < sheets.length; i++) {
      assert.equal(sheets[i]?.name, `Sheet ${i + 1}`);
      assert.equal(sheets[i]?.width, 2200);
      assert.equal(sheets[i]?.height, 2200);
      const image = await sharp(path.join(dir, `floor-${i + 1}.webp`)).metadata();
      assert.equal(image.width, 2200);
      assert.equal(image.height, 2200);
    }
    console.log(JSON.stringify({ pages: sheets.length, chunks: Math.ceil(bytes.length / CHUNK_BYTES), elapsedMs: Date.now() - started, maxRssKB: process.resourceUsage().maxRSS }));
  } finally {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  }
});
