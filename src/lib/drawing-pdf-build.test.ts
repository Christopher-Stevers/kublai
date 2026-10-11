import { afterEach, describe, expect, it, vi } from "vitest";
import { pdfBytes } from "./drawing-pdf-bytes";
afterEach(() => vi.unstubAllGlobals());
describe("bounded drawing PDF downloads", () => {
  it("rejects a stream exceeding the budget even when Content-Length is missing", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream)),
    );
    await expect(pdfBytes("/pdf", undefined, undefined, 5)).rejects.toThrow(
      "export size limit",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("reassembles streamed bytes without changing the source PDF", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream)),
    );
    expect(await pdfBytes("/pdf", undefined, undefined, 4)).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });
});
