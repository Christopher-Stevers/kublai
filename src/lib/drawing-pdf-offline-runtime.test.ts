// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAWING_PDF_RUNTIME_FILES,
  warmDrawingPdfRuntime,
} from "./drawing-pdf-offline-runtime";
const mocks = vi.hoisted(() => ({ load: vi.fn(async () => undefined) }));
vi.mock("./pdf-client", () => ({ loadPdfJs: mocks.load }));
type Port = {
  onmessage: ((event: { data: unknown }) => void) | null;
  close: () => void;
  deliver?: (value: unknown) => void;
};
class Channel {
  port1: Port = { onmessage: null, close: () => undefined };
  port2: Port = {
    onmessage: null,
    close: () => undefined,
    deliver: (value) => this.port1.onmessage?.({ data: value }),
  };
}
const stores = new Map<string, Map<string, Response>>();
const version = "foremenhq-offline-shell-v13";
const main = () =>
  `${location.origin}/_next/static/chunks/drawing-pdf-runtime.123.js`;
const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  stores.clear();
  vi.clearAllMocks();
  vi.stubGlobal("MessageChannel", Channel);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: Promise.resolve({}),
      controller: {
        postMessage: (_: unknown, ports: Port[]) =>
          ports[0]?.deliver?.(version),
      },
    },
  });
  vi.stubGlobal("caches", {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name)!;
      return {
        put: async (url: string, response: Response) => {
          entries.set(url, response);
        },
        match: async (url: string) => entries.get(url)?.clone(),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
      };
    },
  });
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([
    { name: main() } as PerformanceEntry,
  ]);
  fetcher.mockImplementation(async () => new Response("public runtime"));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("explicit public PDF runtime offline preparation", () => {
  it("warms 22 exact package files and the loaded PDF chunk with at most three downloads", async () => {
    let active = 0,
      maximum = 0;
    fetcher.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return new Response("public runtime");
    });
    const result = await warmDrawingPdfRuntime();
    expect(result.files).toBe(23);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(stores.get(`${version}:pdf-runtime`)?.size).toBe(
      DRAWING_PDF_RUNTIME_FILES.length,
    );
    expect(stores.get(`${version}:static`)?.has(main())).toBe(true);
    expect(
      fetcher.mock.calls.every(
        ([url]) =>
          (typeof url === "string" && url.includes("/api/pdfjs-assets/")) ||
          url === main(),
      ),
    ).toBe(true);
  });
  it("fails clearly without a controlling worker and never claims a partial download", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({}), controller: null },
    });
    await expect(warmDrawingPdfRuntime()).rejects.toThrow(/Reload ForemanHQ/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects an unverified main chunk and a cancelled request", async () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    await expect(warmDrawingPdfRuntime()).rejects.toThrow(
      /renderer could not be verified/,
    );
    const abort = new AbortController();
    abort.abort();
    await expect(
      warmDrawingPdfRuntime({ signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports storage failure instead of marking offline setup complete", async () => {
    vi.stubGlobal("caches", {
      open: async () => {
        throw Error("Quota exceeded");
      },
    });
    await expect(warmDrawingPdfRuntime()).rejects.toThrow(/Quota/);
  });
});
