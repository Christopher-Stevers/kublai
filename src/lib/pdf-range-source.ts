import {
  DRAWING_KEPT_FILE,
  keepDrawing,
  mayKeepDrawing,
  readKeptDrawing,
} from "./drawing-kept";
import { noteDrawingTransfer } from "./drawing-network";

/**
 * One downloader per drawing PDF, shared by every reader of it. The page's
 * PDF.js document and the detail worker's document each used to fetch their
 * own byte ranges, so a sheet's bytes crossed a weak signal twice. Readers now
 * ask here: a range is fetched once, kept in memory in small blocks, and a
 * dropped request resumes after the blocks that already arrived.
 *
 * Blocks live in memory for the open drawing folder only and are dropped with
 * the parsed documents on logout or an account change. A small file that has
 * arrived whole (one sheet) is also kept on the device for its account, and
 * read from there on the next visit: see `drawing-kept.ts`.
 */
export const PDF_RANGE_BLOCK = 64 * 1024;
/** Blocks kept across all open PDFs; older ones are fetched again if needed. */
const KEEP_BYTES = 48 * 1024 * 1024;
const KEEP_SOURCES = 3;
const RETRY_MS = [500, 1500, 4000];
/** A file this small is finished in one more request once its size is known:
 * it is a sheet, and all of it is wanted on the device. */
const FINISH_BYTES = 2 * 1024 * 1024;

export type PdfRangeHead = { length: number; head: Uint8Array };

class Unsupported extends Error {}
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });

let kept = 0;
const sources = new Map<string, PdfRangeSource>();
// Owned by the account-scoped offline store; released with its object URLs.
const localFiles = new Map<string, Blob>();
export function registerLocalPdf(url: string, blob: Blob) { localFiles.set(url, blob); }
export function releaseLocalPdf(url: string) {
  localFiles.delete(url);
  sources.get(url)?.dispose();
  sources.delete(url);
}
/** Small files worth one request for everything, with their sizes. */
const whole = new Map<string, number>();

/** A file this small is fetched in one request instead of piece by piece:
 * every round trip is slow on a weak signal. */
export function hintPdfWhole(url: string, bytes: number) {
  whole.delete(url);
  whole.set(url, bytes);
  while (whole.size > 32) whole.delete(whole.keys().next().value!);
}

export class PdfRangeSource {
  private blocks = new Map<number, Uint8Array>();
  private inflight = new Map<number, Promise<Uint8Array>>();
  private controller = new AbortController();
  private length: number | null = null;
  private opening: Promise<PdfRangeHead | null> | null = null;
  private device: Promise<void> | null = null;
  private saved = false;
  constructor(readonly url: string, private local?: Blob) {}

  /** Looks once for a copy kept on this device; it is read like a saved file. */
  private kept() {
    if (this.local || !mayKeepDrawing(this.url)) return null;
    return (this.device ??= readKeptDrawing(this.url).then((blob) => {
      if (blob && !this.controller.signal.aborted && !this.blocks.size) {
        this.local = blob;
        this.saved = true;
      }
    }));
  }

  /** The file's size and first block, or null when ranges are not on offer. */
  open(): Promise<PdfRangeHead | null> {
    const kept = this.kept();
    return kept ? kept.then(() => this.start()) : this.start();
  }

  private start(): Promise<PdfRangeHead | null> {
    if (this.controller.signal.aborted) return Promise.reject(this.controller.signal.reason);
    if (this.local) {
      this.length = this.local.size;
      return this.read(0, Math.min(PDF_RANGE_BLOCK, this.length)).then(head => ({ length: this.length!, head }));
    }
    const bytes = whole.get(this.url);
    if (bytes && !this.opening)
      this.request(0, Math.ceil(bytes / PDF_RANGE_BLOCK) - 1);
    const opening = (this.opening ??= this.block(0)
      .then((head) => {
        const length = this.length!;
        if (!bytes && length <= FINISH_BYTES && mayKeepDrawing(this.url))
          this.request(1, Math.ceil(length / PDF_RANGE_BLOCK) - 1);
        return { length, head };
      })
      .catch((error: unknown) => {
        if (error instanceof Unsupported) return null;
        // A dropped connection may be back for the next reader.
        this.opening = null;
        throw error;
      }));
    return opening.then((found) =>
      found ? { length: found.length, head: found.head.slice() } : null,
    );
  }

  /** Bytes [begin, end) as a fresh array the caller may hand away. */
  async read(begin: number, end: number): Promise<Uint8Array> {
    this.controller.signal.throwIfAborted();
    await this.kept();
    this.controller.signal.throwIfAborted();
    if (this.local) {
      const bytes = await this.local.slice(begin, end).arrayBuffer();
      this.controller.signal.throwIfAborted();
      return new Uint8Array(bytes);
    }
    if (this.length !== null) end = Math.min(end, this.length);
    const first = Math.floor(begin / PDF_RANGE_BLOCK);
    const last = Math.floor(Math.max(begin, end - 1) / PDF_RANGE_BLOCK);
    this.request(first, last);
    const out = new Uint8Array(Math.max(0, end - begin));
    for (let index = first; index <= last; index++) {
      const block = await this.block(index);
      const start = index * PDF_RANGE_BLOCK;
      const from = Math.max(begin, start);
      const to = Math.min(end, start + block.length);
      if (to > from)
        out.set(block.subarray(from - start, to - start), from - begin);
    }
    return out;
  }

  private block(index: number) {
    const cached = this.blocks.get(index);
    if (cached) {
      // Most recently used goes last.
      this.blocks.delete(index);
      this.blocks.set(index, cached);
      return Promise.resolve(cached);
    }
    this.request(index, index);
    return this.inflight.get(index)!;
  }

  /** Starts one request per run of neighbouring blocks nobody has asked for. */
  private request(first: number, last: number) {
    let run: number | null = null;
    for (let index = first; index <= last + 1; index++) {
      const missing =
        index <= last && !this.blocks.has(index) && !this.inflight.has(index);
      if (missing) run ??= index;
      else if (run !== null) {
        this.fetchRun(run, index - 1);
        run = null;
      }
    }
  }

  private fetchRun(first: number, last: number) {
    const waiting = new Map<
      number,
      { resolve: (block: Uint8Array) => void; reject: (error: unknown) => void }
    >();
    for (let index = first; index <= last; index++) {
      const promise = new Promise<Uint8Array>((resolve, reject) =>
        waiting.set(index, { resolve, reject }),
      );
      // Readers attach later; a failed run must not surface as unhandled.
      promise.catch(() => undefined);
      this.inflight.set(index, promise);
    }
    const deliver = (index: number, block: Uint8Array) => {
      this.store(index, block);
      this.inflight.delete(index);
      waiting.get(index)?.resolve(block);
      waiting.delete(index);
    };
    void (async () => {
      const signal = this.controller.signal;
      let next = first;
      let attempt = 0;
      while (next <= last) {
        const before = next;
        let failure: unknown = null;
        try {
          await this.download(
            next,
            last,
            (index, block) => {
              next = index + 1;
              deliver(index, block);
            },
            signal,
          );
        } catch (error) {
          failure = error;
        }
        if (next > last) return;
        // Progress earns a fresh set of retries.
        if (next > before) attempt = 0;
        const retry = RETRY_MS[attempt++];
        if (
          signal.aborted ||
          failure instanceof Unsupported ||
          retry === undefined
        )
          throw failure instanceof Error
            ? failure
            : new Error("The drawing download stopped early.");
        await wait(retry, signal);
      }
    })().catch((error: unknown) => {
      for (const [index, entry] of waiting) {
        this.inflight.delete(index);
        entry.reject(error);
      }
    });
  }

  /** Streams blocks first..last, handing each over as it completes, so a
   * dropped connection resumes after the last whole block. */
  private async download(
    first: number,
    last: number,
    deliver: (index: number, block: Uint8Array) => void,
    signal: AbortSignal,
  ) {
    const begin = first * PDF_RANGE_BLOCK;
    const end = (last + 1) * PDF_RANGE_BLOCK - 1;
    const startedAt = performance.now();
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${begin}-${end}` },
      credentials: "include",
      signal,
    });
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
      response.headers.get("Content-Range") ?? "",
    );
    if (response.status !== 206 || !range || Number(range[1]) !== begin) {
      void response.body?.cancel().catch(() => undefined);
      // A server error may pass; anything else means no ranges here.
      if (response.status >= 500 || response.status === 429)
        throw new Error(`The drawing download failed (${response.status}).`);
      throw new Unsupported();
    }
    this.length = Number(range[3]);
    const total = Number(range[2]) - begin + 1;
    let next = first;
    let received = 0;
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    const flush = (final: boolean) => {
      for (;;) {
        const size = Math.min(
          PDF_RANGE_BLOCK,
          total - (next - first) * PDF_RANGE_BLOCK,
        );
        if (size <= 0 || pendingBytes < size) break;
        const block = new Uint8Array(size);
        let filled = 0;
        while (filled < size) {
          const part = pending[0]!;
          const take = Math.min(part.length, size - filled);
          block.set(part.subarray(0, take), filled);
          filled += take;
          if (take === part.length) pending.shift();
          else pending[0] = part.subarray(take);
        }
        pendingBytes -= size;
        deliver(next++, block);
      }
      if (final) pending = [];
    };
    try {
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          pending.push(value);
          pendingBytes += value.length;
          received += value.length;
          flush(false);
        }
      } else {
        const body = new Uint8Array(await response.arrayBuffer());
        pending.push(body);
        pendingBytes = received = body.length;
      }
    } finally {
      flush(true);
      noteDrawingTransfer(received, performance.now() - startedAt);
    }
  }

  private store(index: number, block: Uint8Array) {
    if (this.blocks.has(index)) return;
    this.blocks.set(index, block);
    kept += block.length;
    this.keep();
    for (const source of sources.values()) {
      if (kept <= KEEP_BYTES) break;
      for (const [old, bytes] of source.blocks) {
        if (kept <= KEEP_BYTES || (source === this && old === index)) break;
        source.blocks.delete(old);
        kept -= bytes.length;
      }
    }
  }

  /** Once every block of a sheet-sized file is here, it stays on the device. */
  private keep() {
    const length = this.length;
    if (this.saved || this.local || length === null) return;
    if (length > DRAWING_KEPT_FILE) return;
    const count = Math.ceil(length / PDF_RANGE_BLOCK);
    if (this.blocks.size !== count || !mayKeepDrawing(this.url)) return;
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    for (let index = 0; index < count; index++) {
      const block = this.blocks.get(index);
      if (!block) return;
      bytes += block.length;
      parts.push(block.slice());
    }
    if (bytes !== length) return;
    this.saved = true;
    void keepDrawing(this.url, new Blob(parts, { type: "application/pdf" }));
  }

  dispose() {
    this.controller.abort();
    this.local = undefined;
    for (const block of this.blocks.values()) kept -= block.length;
    this.blocks.clear();
  }
}

/** Registered local PDFs use Blob.slice instead of loading a whole set into memory. */
const ranged = (url: string) => !/^(blob|data):/i.test(url);

export function pdfRangeSource(url: string) {
  if (!localFiles.has(url) && (!ranged(url) || typeof fetch !== "function")) return null;
  const cached = sources.get(url);
  if (cached) {
    sources.delete(url);
    sources.set(url, cached);
    return cached;
  }
  const source = new PdfRangeSource(url, localFiles.get(url));
  sources.set(url, source);
  while (sources.size > KEEP_SOURCES) {
    const [oldest, old] = sources.entries().next().value!;
    sources.delete(oldest);
    old.dispose();
  }
  return source;
}

/** Call with clearPdfDocuments: private bytes must not outlive identity. */
export function clearPdfRangeSources() {
  for (const source of sources.values()) source.dispose();
  sources.clear();
  whole.clear();
  kept = 0;
}
