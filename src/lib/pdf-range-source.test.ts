import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPdfRangeSources,
  hintPdfWhole,
  PDF_RANGE_BLOCK as BLOCK,
  pdfRangeSource,
} from "./pdf-range-source";

const SIZE = BLOCK * 5 + 100;
const file = Uint8Array.from(
  { length: SIZE },
  (_, i) => (i * 7 + (i >> 9)) & 255,
);
type Plan = { status?: number; cut?: number; fail?: boolean };
let plans: Plan[];
let requests: string[];

function respond(init: RequestInit | undefined) {
  const header = new Headers(init?.headers).get("Range")!;
  requests.push(header);
  const plan = plans.shift() ?? {};
  if (plan.fail) return Promise.reject(new TypeError("Failed to fetch"));
  if (plan.status)
    return Promise.resolve(new Response("whole file", { status: plan.status }));
  const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(header)!;
  const begin = Number(from);
  const end = Math.min(Number(to), SIZE - 1);
  const bytes = file.slice(begin, end + 1);
  // A dropped connection: some bytes arrive, then the stream fails.
  const sent = plan.cut ?? bytes.length;
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      // Uneven pieces, as a network delivers them.
      if (at < sent) {
        controller.enqueue(bytes.slice(at, Math.min(sent, at + 50_000)));
        at += 50_000;
      } else if (plan.cut === undefined) controller.close();
      else controller.error(new TypeError("network error"));
    },
  });
  return Promise.resolve(
    new Response(body, {
      status: 206,
      headers: { "Content-Range": `bytes ${begin}-${end}/${SIZE}` },
    }),
  );
}

describe("shared PDF range downloader", () => {
  beforeEach(() => {
    plans = [];
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => respond(init)),
    );
  });
  afterEach(() => {
    clearPdfRangeSources();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reports the size with the first block", async () => {
    const opened = await pdfRangeSource("/a.pdf")!.open();
    expect(opened!.length).toBe(SIZE);
    expect(opened!.head).toEqual(file.slice(0, BLOCK));
    // One request at a time per file: browsers repeat overlapping ranges.
    expect(requests).toEqual([`bytes=0-${BLOCK - 1}`]);
  });

  it("downloads a range once for two readers", async () => {
    const source = pdfRangeSource("/a.pdf")!;
    await source.open();
    await source.read(BLOCK * 5, SIZE);
    requests.length = 0;
    const [page, worker] = await Promise.all([
      source.read(BLOCK, BLOCK * 3),
      source.read(BLOCK, BLOCK * 3),
    ]);
    expect(requests).toEqual([`bytes=${BLOCK}-${BLOCK * 3 - 1}`]);
    expect(page).toEqual(file.slice(BLOCK, BLOCK * 3));
    expect(worker).toEqual(page);
    // Each reader owns its bytes: PDF.js hands them to another thread.
    expect(worker.buffer).not.toBe(page.buffer);
    await source.read(BLOCK + 10, BLOCK * 2 + 10);
    expect(requests).toHaveLength(1);
  });

  it("fetches only the blocks nobody has asked for", async () => {
    const source = pdfRangeSource("/a.pdf")!;
    await source.read(BLOCK * 2, BLOCK * 3);
    requests.length = 0;
    const bytes = await source.read(BLOCK + 5, BLOCK * 4 - 5);
    expect(requests).toEqual([
      `bytes=${BLOCK}-${BLOCK * 2 - 1}`,
      `bytes=${BLOCK * 3}-${BLOCK * 4 - 1}`,
    ]);
    expect(bytes).toEqual(file.slice(BLOCK + 5, BLOCK * 4 - 5));
  });

  it("reads the short last block", async () => {
    const source = pdfRangeSource("/a.pdf")!;
    await source.open();
    expect(await source.read(BLOCK * 5, BLOCK * 6)).toEqual(
      file.slice(BLOCK * 5),
    );
  });

  it("resumes a dropped download after the blocks that arrived", async () => {
    vi.useFakeTimers();
    const source = pdfRangeSource("/a.pdf")!;
    // The first request delivers one whole block and a bit, then drops.
    plans = [{ cut: BLOCK + 2000 }];
    const reading = source.read(0, BLOCK * 3);
    await vi.advanceTimersByTimeAsync(600);
    const bytes = await reading;
    expect(bytes).toEqual(file.slice(0, BLOCK * 3));
    expect(requests).toContain(`bytes=${BLOCK}-${BLOCK * 3 - 1}`);
    expect(requests.filter((r) => r.startsWith("bytes=0-"))).toHaveLength(1);
  });

  it("gives up after repeated failures and lets a later reader try again", async () => {
    vi.useFakeTimers();
    const source = pdfRangeSource("/a.pdf")!;
    plans = [{ fail: true }, { fail: true }, { fail: true }, { fail: true }];
    const failed = expect(source.read(0, BLOCK)).rejects.toThrow(
      "Failed to fetch",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(requests).toHaveLength(4);
    expect(await source.read(0, BLOCK)).toEqual(file.slice(0, BLOCK));
  });

  it("reports no range support when the server sends the whole file", async () => {
    plans = [{ status: 200 }];
    expect(await pdfRangeSource("/a.pdf")!.open()).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("fetches a small file in one request when told its size", async () => {
    hintPdfWhole("/page.pdf", SIZE);
    const source = pdfRangeSource("/page.pdf")!;
    const opened = await source.open();
    expect(opened!.length).toBe(SIZE);
    // The end of the file, which PDF.js reads first, needs no second request.
    expect(await source.read(SIZE - 300, SIZE)).toEqual(
      file.slice(SIZE - 300, SIZE),
    );
    expect(await source.read(BLOCK, BLOCK * 3)).toEqual(
      file.slice(BLOCK, BLOCK * 3),
    );
    expect(requests).toEqual([`bytes=0-${BLOCK * 6 - 1}`]);
    // The hint goes with the cleared sources.
    clearPdfRangeSources();
    await pdfRangeSource("/page.pdf")!.open();
    expect(requests[1]).toBe(`bytes=0-${BLOCK - 1}`);
  });

  it("leaves files already on the device to PDF.js", () => {
    expect(pdfRangeSource("blob:https://app.example/1234")).toBeNull();
    expect(pdfRangeSource("data:application/pdf;base64,AAAA")).toBeNull();
  });

  it("forgets downloaded bytes when cleared", async () => {
    const source = pdfRangeSource("/a.pdf")!;
    await source.read(0, BLOCK);
    clearPdfRangeSources();
    const again = pdfRangeSource("/a.pdf")!;
    expect(again).not.toBe(source);
    requests.length = 0;
    await again.read(0, BLOCK);
    expect(requests[0]).toBe(`bytes=0-${BLOCK - 1}`);
  });
});
