import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as PdfClient from "./pdf-client";
import { sourcePdfPage } from "./pdf-client";

const job = "0391aed4-7773-47ec-9141-09df373ec008";
const upload = "d814fc88-da7c-4df5-aa89-fe3c1fde0462";

describe("sourcePdfPage", () => {
  it("resolves private document pages to the original authenticated PDF", () => {
    expect(
      sourcePdfPage(`/api/job-documents/pages/${upload}/2?jobId=${job}`),
    ).toEqual({
      url: `/api/job-documents/files/${upload}?jobId=${job}`,
      page: 2,
    });
    expect(
      sourcePdfPage(
        `https://evil.example/api/job-documents/pages/${upload}/2?jobId=${job}`,
      ),
    ).toBeNull();
    expect(
      sourcePdfPage(`/api/job-documents/pages/${upload}/0?jobId=${job}`),
    ).toBeNull();
  });
  it("maps a split drawing image to its original PDF page", () => {
    expect(
      sourcePdfPage(`/api/job-rooms/files/${job}/${upload}/floor-14.webp`),
    ).toEqual({
      url: `/api/job-rooms/files/${job}/${upload}/plan.pdf`,
      page: 14,
    });
  });
  it("ignores anything else", () => {
    expect(
      sourcePdfPage(`/api/job-rooms/files/${job}/floor-1.webp`),
    ).toBeNull();
    expect(sourcePdfPage("https://evil.example/floor-1.webp")).toBeNull();
    expect(
      sourcePdfPage(`/api/job-rooms/files/${job}/${upload}/plan.pdf`),
    ).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function loadingTask(id: string) {
  const document = { id };
  return {
    document,
    promise: Promise.resolve(document),
    destroy: vi.fn(async () => undefined),
  };
}

describe("browser PDF document cache", () => {
  let client: typeof PdfClient;
  let libraryReady: ReturnType<typeof deferred<void>>;
  let workerOptions: { workerSrc: string };
  const getDocument = vi.fn((options: { url: string }) =>
    loadingTask(options.url),
  );

  beforeEach(async () => {
    vi.resetModules();
    libraryReady = deferred<void>();
    workerOptions = { workerSrc: "" };
    getDocument
      .mockReset()
      .mockImplementation((options) => loadingTask(options.url));
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      await libraryReady.promise;
      return { getDocument, GlobalWorkerOptions: workerOptions };
    });
    client = await import("./pdf-client");
  });

  afterEach(() => {
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs");
  });

  it("discards only the stalled cached document and preserves a newer replacement", async () => {
    libraryReady.resolve();
    const task = loadingTask("/stalled.pdf");
    getDocument.mockReturnValueOnce(task);
    const original = client.loadPdfDocument("/stalled.pdf");
    await original;
    client.discardPdfDocument("/stalled.pdf", original);
    expect(task.destroy).toHaveBeenCalledOnce();
    const replacement = client.loadPdfDocument("/stalled.pdf");
    await replacement;
    client.discardPdfDocument("/stalled.pdf", original);
    expect(client.loadPdfDocument("/stalled.pdf")).toBe(replacement);
    expect(replacement).not.toBe(original);
  });

  it("shares an in-flight request and enables authenticated demand-driven range loading", async () => {
    const first = client.loadPdfDocument("/one.pdf");
    const duplicate = client.loadPdfDocument("/one.pdf");
    expect(duplicate).toBe(first);
    expect(getDocument).not.toHaveBeenCalled();
    libraryReady.resolve();
    await first;
    expect(getDocument).toHaveBeenCalledExactlyOnceWith({
      url: "/one.pdf",
      withCredentials: true,
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize: 256 * 1024,
      enableHWA: true,
      wasmUrl: "/api/pdfjs-assets/wasm/",
      standardFontDataUrl: "/api/pdfjs-assets/standard_fonts/",
    });
    expect(workerOptions.workerSrc).toBe(
      "/api/pdfjs-assets/legacy/build/pdf.worker.min.mjs",
    );
    expect(client.loadPdfDocument("/one.pdf")).toBe(first);
  });

  it("retains the most recently used PDF and destroys only the evicted document", async () => {
    libraryReady.resolve();
    const first = loadingTask("first");
    const second = loadingTask("second");
    const third = loadingTask("third");
    getDocument
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const firstPromise = client.loadPdfDocument("/one.pdf");
    await firstPromise;
    await client.loadPdfDocument("/two.pdf");
    expect(client.loadPdfDocument("/one.pdf")).toBe(firstPromise);
    await client.loadPdfDocument("/three.pdf");
    expect(second.destroy).toHaveBeenCalledOnce();
    expect(first.destroy).not.toHaveBeenCalled();
    expect(third.destroy).not.toHaveBeenCalled();
  });

  it("destroys loaded and still-initializing private documents when the account is cleared", async () => {
    const pending = loadingTask("pending");
    getDocument.mockReturnValueOnce(pending);
    const first = client.loadPdfDocument("/private.pdf");
    client.clearPdfDocuments();
    libraryReady.resolve();
    await first;
    expect(pending.destroy).toHaveBeenCalledOnce();
    const replacement = loadingTask("new account");
    getDocument.mockReturnValueOnce(replacement);
    const second = client.loadPdfDocument("/private.pdf");
    expect(second).not.toBe(first);
    await second;
    client.clearPdfDocuments();
    client.clearPdfDocuments();
    expect(replacement.destroy).toHaveBeenCalledOnce();
  });

  it("cleans up an evicted request even when the PDF.js import has not finished", async () => {
    const evicted = loadingTask("evicted");
    const second = loadingTask("second");
    const third = loadingTask("third");
    getDocument
      .mockReturnValueOnce(evicted)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const requests = ["/one.pdf", "/two.pdf", "/three.pdf"].map(
      client.loadPdfDocument,
    );
    expect(getDocument).not.toHaveBeenCalled();
    libraryReady.resolve();
    await Promise.all(requests);
    expect(evicted.destroy).toHaveBeenCalledOnce();
    expect(second.destroy).not.toHaveBeenCalled();
    expect(third.destroy).not.toHaveBeenCalled();
  });

  it("retries a failed document instead of retaining its rejected promise", async () => {
    libraryReady.resolve();
    const failure = deferred<{ id: string }>();
    const failedTask = {
      ...loadingTask("failed"),
      promise: failure.promise,
    };
    getDocument.mockReturnValueOnce(failedTask);
    const first = client.loadPdfDocument("/one.pdf");
    const rejected = expect(first).rejects.toThrow("Network interrupted");
    await client.loadPdfJs();
    failure.reject(new Error("Network interrupted"));
    await rejected;
    expect(failedTask.destroy).toHaveBeenCalledOnce();
    const second = client.loadPdfDocument("/one.pdf");
    expect(second).not.toBe(first);
    await expect(second).resolves.toEqual({ id: "/one.pdf" });
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it("retries PDF.js initialization after a transient lazy-import failure", async () => {
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      await libraryReady.promise;
      throw new Error("PDF.js chunk download interrupted");
    });
    const first = client.loadPdfDocument("/one.pdf");
    const rejected = expect(first).rejects.toThrow();
    libraryReady.resolve();
    await rejected;
    expect(getDocument).not.toHaveBeenCalled();

    // Simulate the next successful chunk request, keeping the same application
    // module instance so this fails if loadPdfJs caches its rejected promise.
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
      getDocument,
      GlobalWorkerOptions: workerOptions,
    }));
    await expect(client.loadPdfDocument("/one.pdf")).resolves.toEqual({
      id: "/one.pdf",
    });
    expect(getDocument).toHaveBeenCalledOnce();
    expect(workerOptions.workerSrc).toBe(
      "/api/pdfjs-assets/legacy/build/pdf.worker.min.mjs",
    );
  });

  it("does not remove a replacement entry when an older evicted request fails late", async () => {
    libraryReady.resolve();
    const oldResult = deferred<{ id: string }>();
    const oldTask = { ...loadingTask("old"), promise: oldResult.promise };
    getDocument.mockReturnValueOnce(oldTask);
    const original = client.loadPdfDocument("/one.pdf");
    const rejected = expect(original).rejects.toThrow("Old request cancelled");
    await client.loadPdfDocument("/two.pdf");
    await client.loadPdfDocument("/three.pdf");
    const replacement = client.loadPdfDocument("/one.pdf");
    await replacement;
    oldResult.reject(new Error("Old request cancelled"));
    await rejected;
    expect(oldTask.destroy).toHaveBeenCalledOnce();
    expect(client.loadPdfDocument("/one.pdf")).toBe(replacement);
    expect(getDocument).toHaveBeenCalledTimes(4);
  });

  it("does not leak cleanup errors when an evicted worker is already unavailable", async () => {
    libraryReady.resolve();
    const oldTask = loadingTask("old");
    oldTask.destroy.mockRejectedValueOnce(new Error("Worker already gone"));
    getDocument.mockReturnValueOnce(oldTask);
    await client.loadPdfDocument("/one.pdf");
    await client.loadPdfDocument("/two.pdf");
    await expect(client.loadPdfDocument("/three.pdf")).resolves.toEqual({
      id: "/three.pdf",
    });
    expect(oldTask.destroy).toHaveBeenCalledOnce();
  });
});
