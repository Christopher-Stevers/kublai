"use client";

import type {
  PipeSymbolTemplate,
  PipeComponentsResult,
} from "./pipe-components-types";

import type { SnapIndex, SnapSegment } from "./sheet-snap";
import type { PipeLinework, PipeSystemSelection } from "./pipe-system";
import type { SheetPoint } from "./sheet-measure";
import { pipeSizeTags, type PipeSizeTag } from "./pipe-run-sizes";
import type {
  GeometryRequest,
  GeometryResponse,
  GeometryValue,
  PipeGeometryInfo,
} from "./drawing-geometry-protocol";

type Command = GeometryRequest extends infer R
  ? R extends GeometryRequest
    ? Omit<R, "id">
    : never
  : never;
const clients = new Set<{ dispose: () => void }>();
// Copying a whole CAD page into a worker is itself a long UI task. Send small
// acknowledged batches, allowing touch input and painting between them.
const INPUT_BATCH = 2_000;
const aborted = () =>
  new DOMException("The drawing geometry request was cancelled.", "AbortError");

/** Register other drawing workers with the same account lifecycle. */
export function registerDrawingWorker(client: { dispose: () => void }) {
  clients.add(client);
  return () => clients.delete(client);
}

/** Private drawing work must not survive logout or an account switch. */
export function clearDrawingGeometryWorkers() {
  for (const client of [...clients]) client.dispose();
}

// Loading fallback code is asynchronous, unlike the original inline fallback.
// Keep it in the same synchronous account-clear registry during that new gap.
function beginFallbackLoad(signal?: AbortSignal) {
  let cancelled = false;
  let rejectLoad: ((error: Error) => void) | undefined;
  const lease = {dispose: () => { cancelled = true; rejectLoad?.(aborted()); }};
  const unregister = registerDrawingWorker(lease);
  const cancel = () => lease.dispose();
  signal?.addEventListener("abort", cancel, {once: true});
  return {
    assertActive() { if (cancelled || signal?.aborted) throw aborted(); },
    waitFor<T>(pending: Promise<T>) {
      return new Promise<T>((resolve, reject) => {
        rejectLoad = reject;
        void pending.then(value => {
          if (cancelled || signal?.aborted) reject(aborted());
          else resolve(value);
        }, (error: unknown) => reject(error instanceof Error ? error : new Error("Drawing engine failed to load")));
      });
    },
    release() { rejectLoad = undefined; signal?.removeEventListener("abort", cancel); unregister(); },
  };
}

class GeometryClient {
  private worker: Worker;
  private sequence = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (value: GeometryValue) => void;
      reject: (error: Error) => void;
      cleanup: () => void;
    }
  >();
  constructor() {
    this.worker = new Worker(
      new URL("./drawing-geometry.worker.ts", import.meta.url),
      { type: "module", name: "drawing-geometry" },
    );
    clients.add(this);
    this.worker.onmessage = ({ data }: MessageEvent<GeometryResponse>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      pending.cleanup();
      if (data.ok) pending.resolve(data.value);
      else pending.reject(new Error(data.error));
    };
    this.worker.onerror = () =>
      this.dispose(
        new Error("The drawing geometry worker stopped. Try again."),
      );
    this.worker.onmessageerror = () =>
      this.dispose(new Error("The drawing geometry result could not be read."));
  }
  request<T extends GeometryValue>(
    command: Command,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.closed || signal?.aborted) return Promise.reject(aborted());
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      // A worker cannot handle a cancel message while computing. Termination
      // cancels the CPU work as well as preventing a late result from appearing.
      const cancel = () => this.dispose();
      signal?.addEventListener("abort", cancel, { once: true });
      const cleanup = () => signal?.removeEventListener("abort", cancel);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup,
      });
      try {
        this.worker.postMessage({ ...command, id });
      } catch (error) {
        this.pending.delete(id);
        cleanup();
        reject(
          error instanceof Error
            ? error
            : new Error("The drawing geometry could not be sent."),
        );
      }
    });
  }
  dispose(error: Error = aborted()) {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    clients.delete(this);
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}
function createClient() {
  if (typeof Worker === "undefined") return null;
  // Retain the original computation for browsers that cannot start a worker.
  try {
    return new GeometryClient();
  } catch {
    return null;
  }
}

export async function buildDrawingSnapIndex(
  segments: SnapSegment[],
  aspect: number,
  signal?: AbortSignal,
): Promise<SnapIndex> {
  signal?.throwIfAborted();
  const client = createClient();
  if (!client) {
    const lease = beginFallbackLoad(signal);
    try {
      lease.assertActive();
      const fallback = await lease.waitFor(import("./drawing-geometry-fallback"));
      lease.assertActive();
      return fallback.buildFallbackSnapIndex(segments, aspect);
    } finally { lease.release(); }
  }
  try {
    for (let offset = 0; offset < segments.length; offset += INPUT_BATCH)
      await client.request(
        {
          kind: "snap-chunk",
          segments: segments.slice(offset, offset + INPUT_BATCH),
        },
        signal,
      );
    return await client.request<SnapIndex>({ kind: "snap", aspect }, signal);
  } finally {
    client.dispose();
  }
}

export type PipeGeometrySession = PipeGeometryInfo & {
  /** Sheet height / width, for measuring lengths in sheet widths. */
  aspect: number;
  /** Pipe sizes printed on the sheet, for splitting a selection by size. */
  sizeTags: PipeSizeTag[];
  components: (
    templates: PipeSymbolTemplate[],
  ) => Promise<PipeComponentsResult>;
  selectLayer: (system: string) => Promise<PipeSystemSelection>;
  select: (
    point: SheetPoint,
    tolerance: number,
    system?: string,
  ) => Promise<PipeSystemSelection>;
  dispose: () => void;
};
export async function createPipeGeometrySession(
  linework: PipeLinework,
  signal?: AbortSignal,
): Promise<PipeGeometrySession> {
  signal?.throwIfAborted();
  const client = createClient();
  if (client) {
    try {
      await client.request(
        { kind: "pipe-start", linework: { ...linework, segments: [] } },
        signal,
      );
      for (
        let offset = 0;
        offset < linework.segments.length;
        offset += INPUT_BATCH
      )
        await client.request(
          {
            kind: "pipe-chunk",
            segments: linework.segments.slice(offset, offset + INPUT_BATCH),
          },
          signal,
        );
      const info = await client.request<PipeGeometryInfo>(
        { kind: "pipe-load" },
        signal,
      );
      return {
        ...info,
        aspect: linework.aspect,
        sizeTags: pipeSizeTags(linework.texts ?? []),
        components: (templates) =>
          client.request<PipeComponentsResult>({
            kind: "pipe-components",
            templates,
          }),
        selectLayer: (system) =>
          client.request<PipeSystemSelection>({ kind: "pipe-layer", system }),
        select: (point, tolerance, system) =>
          client.request<PipeSystemSelection>({
            kind: "pipe-select",
            point,
            tolerance,
            system,
          }),
        dispose: () => client.dispose(),
      };
    } catch (error) {
      client.dispose();
      throw error;
    }
  }
  const lease = beginFallbackLoad(signal);
  try {
    lease.assertActive();
    const fallback = await lease.waitFor(import("./drawing-geometry-fallback"));
    lease.assertActive();
    // The session joins the existing account cleanup set before this lease ends.
    return fallback.createFallbackPipeSession(linework, registerDrawingWorker, aborted);
  } finally { lease.release(); }

}
