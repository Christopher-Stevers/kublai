import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import sharp from "sharp";

void test("document previews render original ink once and reuse private immutable page derivatives", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pdf-preview-study-"));
  process.env.JOB_DOCUMENT_STORAGE_ROOT = root;
  const { writeDocumentBlob, documentBlobPath } = await import("./storage");
  const { documentPagePreview } = await import("./page-preview");
  const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([1000, 500]);
    page.drawRectangle({
      x: 100,
      y: 100,
      width: 400,
      height: 200,
      color: rgb(0, 0, 0),
    });
    const hash = await writeDocumentBlob(org, await pdf.save());
    const [first, concurrent] = await Promise.all([
      documentPagePreview(org, hash, 1),
      documentPagePreview(org, hash, 1),
    ]);
    assert.deepEqual(first, concurrent);
    const metadata = await sharp(first).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 1400);
    assert.equal(metadata.height, 700);
    const raw = await sharp(first).removeAlpha().raw().toBuffer();
    assert.ok(
      raw.some((v) => v < 10),
      "Preview must contain real ink, not blank paper",
    );
    const filename = `${documentBlobPath(org, hash)}.preview-v1/1.webp`;
    const before = await stat(filename);
    assert.equal(before.mode & 0o777, 0o600);
    assert.deepEqual(await documentPagePreview(org, hash, 1), first);
    assert.equal((await stat(filename)).mtimeMs, before.mtimeMs);
    assert.deepEqual(await readdir(path.dirname(filename)), ["1.webp"]);
    await assert.rejects(documentPagePreview("../other-org", hash, 1));
    await assert.rejects(documentPagePreview(org, hash, 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
