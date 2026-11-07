import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { renderPdfPageWithoutText } from "./hybrid/render-page";
import { renderUploadPdf } from "./upload-render";

/**
 * Independently drawn 64x64 monochrome room: 3px outer wall, bottom doorway,
 * and an interior partition. No customer drawing or third-party fixture.
 * JBIG2 page-info + immediate MMR region; no globals, fonts or external data.
 * The MMR bytes were encoded once using Pillow/libtiff Group 4, then verified
 * with Poppler. Keeping them embedded makes this a real decoder regression.
 */
function jbig2RoomPdf() {
  const jbig2 = Buffer.from(
    "000000013000010000001300000040000000400000000000000000010000" +
      "0000000226000100000044000000400000004000000000000000000001" +
      "ff33064ff30830cfffffffffffffffffffffffffffffffffffffffffffffffffffe3ffffffffffffffc837efff11ff001001",
    "hex",
  );
  const stream = (dictionary: string, data: Buffer) =>
    Buffer.concat([
      Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`),
      data,
      Buffer.from("\nendstream"),
    ]);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>",
    ),
    stream("", Buffer.from("q 64 0 0 64 0 0 cm /Im Do Q")),
    stream(
      "/Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /JBIG2Decode",
      jbig2,
    ),
  ];
  let pdf = Buffer.from("%PDF-1.4\n");
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
  }
  return Buffer.concat([
    pdf,
    Buffer.from(
      `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`,
    ),
  ]);
}

function isWall(x: number, y: number) {
  const outer =
    x >= 8 &&
    x <= 55 &&
    y >= 8 &&
    y <= 55 &&
    (x <= 10 || x >= 53 || y <= 10 || y >= 53);
  const doorway = x >= 30 && x <= 35 && y >= 53;
  const partition = x >= 31 && x <= 33 && y >= 9 && y <= 40;
  return (outer && !doorway) || partition;
}

void test("room detector preserves every wall pixel in a JBIG2-only PDF", async () => {
  const page = await renderPdfPageWithoutText(jbig2RoomPdf(), 1, 64);
  assert.equal(page.width, 64);
  assert.equal(page.height, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const index = (y * 64 + x) * 4;
      assert.equal(page.rgba[index], isWall(x, y) ? 0 : 255, `${x},${y}`);
      assert.equal(page.rgba[index + 3], 255);
    }
  }
});

void test("isolated upload renderer retains a monochrome plan and its open doorway", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "jbig2-upload-test-"));
  try {
    await writeFile(path.join(dir, "plan.pdf"), jbig2RoomPdf());
    const sheets = await renderUploadPdf(dir, "fixture-job", "fixture-upload");
    assert.equal(sheets.length, 1);
    assert.equal(sheets[0]?.width, 128);
    assert.equal(sheets[0]?.height, 128);
    const { data, info } = await sharp(path.join(dir, "floor-1.webp"))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const intensity = (x: number, y: number) =>
      data[(y * info.width + x) * info.channels]!;
    assert.ok(intensity(18, 18) < 30, "outer wall must be visible");
    assert.ok(intensity(64, 40) < 30, "interior partition must be visible");
    assert.ok(intensity(64, 108) > 225, "doorway must remain open");
    assert.ok(intensity(40, 40) > 225, "room interior must remain empty");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
