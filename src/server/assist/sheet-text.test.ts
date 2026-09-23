// @vitest-environment node
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { readSheetText } from "./sheet-text";
function tinyPdf() {
  const stream = "BT /F1 16 Tf 40 700 Td (A101 LEVEL 1 FLOOR PLAN) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
it("extracts text from an actual PDF in the isolated worker", async () => {
  const jobId = crypto.randomUUID();
  const directory = path.join(process.cwd(), "uploads/job-floor-plans", jobId);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, "plan.pdf"), tinyPdf());
    const result = await readSheetText({
      jobId,
      imageUrl: `/api/job-rooms/files/${jobId}/floor-1.webp`,
      pageNumber: 1,
    });
    expect(result.text).toContain("A101 LEVEL 1 FLOOR PLAN");
    expect(result.truncated).toBe(false);
  } finally {
    await rm(directory, { recursive: true });
  }
}, 40_000);
it("rejects path traversal and another job’s file", async () => {
  const jobId = crypto.randomUUID();
  for (const imageUrl of [
    `/api/job-rooms/files/${jobId}/../floor-1.webp`,
    `/api/job-rooms/files/${crypto.randomUUID()}/floor-1.webp`,
  ]) {
    await expect(
      readSheetText({ jobId, imageUrl, pageNumber: 1 }),
    ).rejects.toThrow();
  }
});
