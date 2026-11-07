import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { renderUploadPdf } from "../rooms/upload-render";

void test("real page renderer extracts number and multiline title from vector and image-only PDF pages", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([720, 540]);
  page.drawText("SEE M-999 FOR DETAILS", { x: 450, y: 190, size: 9, font });
  page.drawText("DWG TITLE", { x: 560, y: 85, size: 8, font });
  page.drawText("GROUND FLOOR", { x: 560, y: 68, size: 10, font });
  page.drawText("PLUMBING PLAN", { x: 560, y: 55, size: 10, font });
  page.drawText("DWG No.", { x: 610, y: 32, size: 8, font });
  page.drawText("P-101", { x: 595, y: 15, size: 18, font });
  // A landscape page stored sideways must have the same displayed coordinates.
  const rotated = pdf.addPage([540, 720]);
  rotated.setRotation(degrees(270));
  const embedded = await pdf.embedPage(page);
  rotated.drawPage(embedded, {
    x: 0,
    y: 720,
    width: 720,
    height: 540,
    rotate: degrees(270),
  });
  // This page has no embedded text: the upload worker must read its raster title block.
  const canvas = createCanvas(1800, 1350),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1800, 1350);
  ctx.fillStyle = "black";
  ctx.font = "26px sans-serif";
  ctx.fillText("DWG TITLE", 1400, 970);
  ctx.font = "36px sans-serif";
  ctx.fillText("GROUND FLOOR", 1400, 1010);
  ctx.fillText("PLUMBING PLAN", 1400, 1055);
  ctx.font = "26px sans-serif";
  ctx.fillText("DWG No.", 1450, 1170);
  ctx.font = "64px sans-serif";
  ctx.fillText("P-102", 1430, 1250);
  const image = await pdf.embedPng(canvas.toBuffer("image/png"));
  const scan = pdf.addPage([720, 540]);
  scan.drawImage(image, { x: 0, y: 0, width: 720, height: 540 });
  const dir = await mkdtemp(path.join(tmpdir(), "drawing-identities-"));
  try {
    await writeFile(path.join(dir, "plan.pdf"), await pdf.save());
    const sheets = await renderUploadPdf(dir, "job", "upload", {
      drawingMetadata: true,
    });
    assert.equal(sheets.length, 3);
    assert.deepEqual(sheets[0]?.metadata, {
      number: "P-101",
      title: "GROUND FLOOR PLUMBING PLAN",
      discipline: "Plumbing",
    });
    assert.deepEqual(sheets[1]?.metadata, sheets[0]?.metadata);
    assert.deepEqual(sheets[2]?.metadata, {
      number: "P-102",
      title: "GROUND FLOOR PLUMBING PLAN",
      discipline: "Plumbing",
    });
    assert.deepEqual(
      sheets.map((s) => s.name),
      ["P-101", "P-101", "P-102"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
