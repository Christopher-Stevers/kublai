// @vitest-environment node
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { blankOfficeDocument } from "./editor-blank";

function templateParts(bytes: Buffer) {
  const parts: Record<string, string> = {};
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const length = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    const begin = offset + 30 + nameLength + extraLength;
    const payload = bytes.subarray(begin, begin + length);
    parts[name] = (method === 8 ? inflateRawSync(payload) : payload).toString(
      "utf8",
    );
    offset = begin + length;
  }
  return parts;
}
describe("Blank live editor documents", () => {
  it("creates a Word package with a valid main document and no external links or macros", () => {
    const document = blankOfficeDocument("word", "Report");
    const parts = templateParts(document.bytes);
    expect(document.name).toBe("Report.docx");
    expect(Object.keys(parts).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
    ]);
    expect(parts["word/document.xml"]).toContain("<w:document");
    expect(parts["word/document.xml"]).toContain("<w:body>");
    expect(parts["[Content_Types].xml"]).toContain(
      "wordprocessingml.document.main+xml",
    );
    for (const xml of Object.values(parts))
      expect(xml).not.toMatch(
        /TargetMode=["']External|<!DOCTYPE|<!ENTITY|vbaProject|macroEnabled/,
      );
  });
  it("creates an independently readable Excel workbook with one empty worksheet", () => {
    const document = blankOfficeDocument("spreadsheet", "Schedule");
    const workbook = XLSX.read(document.bytes, { type: "buffer" });
    expect(document.name).toBe("Schedule.xlsx");
    expect(workbook.SheetNames).toEqual(["Sheet1"]);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.Sheet1!)).toEqual([]);
    for (const xml of Object.values(templateParts(document.bytes)))
      expect(xml).not.toMatch(
        /TargetMode=["']External|<!DOCTYPE|<!ENTITY|vbaProject|macroEnabled/,
      );
  });
  it("normalizes upload-safe filenames without repeating Office suffixes or exceeding limits", () => {
    expect(blankOfficeDocument("word", "../Report.xlsx").name).toBe(
      "Report.docx",
    );
    expect(blankOfficeDocument("spreadsheet", "Report.DOCX").name).toBe(
      "Report.xlsx",
    );
    expect(blankOfficeDocument("word", ".docx").name).toBe("Document.docx");
    expect(blankOfficeDocument("word", "A".repeat(300)).name.length).toBe(200);
    expect(blankOfficeDocument("word", "folder\\report\u0000").name).toBe(
      "report.docx",
    );
  });
});
