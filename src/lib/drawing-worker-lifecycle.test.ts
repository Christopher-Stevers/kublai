import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDrawingGeometryWorkers, registerDrawingWorker } from "./drawing-worker-lifecycle";
import {
  buildDrawingSnapIndex,
  clearDrawingGeometryWorkers as clearViaGeometry,
  registerDrawingWorker as registerViaGeometry,
} from "./drawing-geometry-client";
import { clearPdfDocuments } from "./pdf-client";

afterEach(() => {
  clearDrawingGeometryWorkers();
  vi.unstubAllGlobals();
});

describe("shared synchronous drawing worker lifecycle", () => {
  it("preserves one registry across the old geometry API and global PDF account cleanup", () => {
    expect(registerViaGeometry).toBe(registerDrawingWorker);
    expect(clearViaGeometry).toBe(clearDrawingGeometryWorkers);
    let stop = () => false;
    const dispose = vi.fn(() => { stop(); });
    stop = registerViaGeometry({ dispose });
    clearPdfDocuments();
    expect(dispose).toHaveBeenCalledOnce();
    clearDrawingGeometryWorkers();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("global account clear terminates a real pending geometry client synchronously", async () => {
    const workers: { terminate: ReturnType<typeof vi.fn> }[] = [];
    class Worker {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() { workers.push(this); }
    }
    vi.stubGlobal("Worker", Worker);
    const task = buildDrawingSnapIndex([], 1);
    const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(workers).toHaveLength(1);
    clearPdfDocuments();
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    await rejected;
  });

  it("retains unregister and dispose-during-clear semantics without an async gap", () => {
    const removed = vi.fn();
    registerDrawingWorker({ dispose: removed })();
    let unregisterFirst = () => false;
    const first = vi.fn(() => { unregisterFirst(); });
    unregisterFirst = registerDrawingWorker({ dispose: first });
    const last = vi.fn();
    const unregisterLast = registerDrawingWorker({ dispose: last });
    clearViaGeometry();
    expect(removed).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledOnce();
    expect(last).toHaveBeenCalledOnce();
    unregisterLast();
  });
});
