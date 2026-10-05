// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GET } from "./route";

const get = (path: string) =>
  GET(new Request(`http://local/api/pdfjs-assets/${path}`), {
    params: Promise.resolve({ path: path.split("/") }),
  });

describe("PDF.js assets", () => {
  it("serves the worker, decoders and standard fonts from the installed package", async () => {
    const worker = await get("legacy/build/pdf.worker.min.mjs");
    expect(worker.status).toBe(200);
    expect(worker.headers.get("content-type")).toContain("javascript");
    expect((await get("wasm/jbig2.wasm")).headers.get("content-type")).toBe("application/wasm");
    expect((await get("standard_fonts/FoxitFixed.pfb")).status).toBe(200);
  });
  it("refuses anything outside the allowed files", async () => {
    for (const path of ["package.json", "../../../.env", "wasm/../package.json", "build/pdf.mjs", "wasm/missing.wasm"])
      expect((await get(path)).status).toBe(404);
  });
});
