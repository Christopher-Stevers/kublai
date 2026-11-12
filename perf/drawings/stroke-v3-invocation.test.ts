import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { STROKE_V3_HASH, validateDrawingInvocation, selectStrokeV3Sample, verifyStrokeV3Bytes, reserveStrokeV3Output, verifyStrokeV3ReferenceInputs, PDFJS_V2_REFERENCE_SHA256 } from "./stroke-v3-invocation";
const root = "/owned/private";
const valid = () => ({ DRAWING_STROKE_V3: "1", DRAWING_ONLY_HASH: STROKE_V3_HASH, DRAWING_STROKE_V3_OUTPUT: root + "/stroke-v3-new" });
describe("stroke-v3 exclusive invocation", () => {
  it("requires unambiguous mode, full hash, exact shard and direct child", () => {
    expect(validateDrawingInvocation(valid(), root).strokeV3).toBe(true);
    for (const delta of [
      { DRAWING_ONLY_HASH: undefined }, { DRAWING_ONLY_HASH: STROKE_V3_HASH.slice(0, 12) },
      { DRAWING_SHARDS: "2" }, { DRAWING_SHARD: "-1" }, { DRAWING_SHARD: "NaN" },
      { DRAWING_SHARDS: "0" }, { DRAWING_SHARD: "0.5" }, { DRAWING_STROKE_V3: "0" },
      { DRAWING_COMBINED_PROTOTYPE: "1" }, { DRAWING_GLYPH_PROTOTYPE: "0" },
      { DRAWING_STROKE_V3_OUTPUT: root + "/../stroke-v3-escape" },
      { DRAWING_STROKE_V3_OUTPUT: "relative" },
    ]) expect(() => validateDrawingInvocation({ ...valid(), ...delta }, root)).toThrow();
  });
  it("rejects missing/duplicate corpus matches and wrong bytes before reservation", () => {
    expect(() => selectStrokeV3Sample([])).toThrow();
    expect(() => selectStrokeV3Sample([{ hash: STROKE_V3_HASH }, { hash: STROKE_V3_HASH }])).toThrow();
    expect(() => verifyStrokeV3Bytes(new Uint8Array([1, 2]))).toThrow();
  });
  it("binds the actual corpus bytes and pinned reference before reserving output", () => {
    const bytes = Buffer.from('{"samples":[]}');
    const inputs = { [path.join(root,"corpus.json")]: createHash("sha256").update(bytes).digest("hex"), "node_modules/pdfjs-dist/legacy/build/pdf.mjs": PDFJS_V2_REFERENCE_SHA256 };
    expect(verifyStrokeV3ReferenceInputs(inputs,bytes,root).pdfjsReferenceSha256).toBe(PDFJS_V2_REFERENCE_SHA256);
    expect(() => verifyStrokeV3ReferenceInputs(inputs,Buffer.from("changed"),root)).toThrow();
    expect(() => verifyStrokeV3ReferenceInputs({...inputs,"node_modules/pdfjs-dist/legacy/build/pdf.mjs":"0".repeat(64)},bytes,root)).toThrow();
  });
  it("never replaces prior failed output", async () => {
    const privateRoot = await mkdtemp(path.join(os.tmpdir(), "stroke-v3-output-test-"));
    const output = path.join(privateRoot, "stroke-v3-once");
    try {
      await reserveStrokeV3Output(output, privateRoot);
      await writeFile(path.join(output, "failed.json"), "preserve");
      await expect(reserveStrokeV3Output(output, privateRoot)).rejects.toThrow();
    } finally { await rm(privateRoot, { recursive: true, force: true }); }
  });
});
