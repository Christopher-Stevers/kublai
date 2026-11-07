import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDrawingSnapIndex,
  clearDrawingGeometryWorkers,
  createPipeGeometrySession,
} from "./drawing-geometry-client";
import { buildSnapIndex, mergeCollinear } from "./sheet-snap";
import type {
  GeometryRequest,
  GeometryResponse,
} from "./drawing-geometry-protocol";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<GeometryResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: GeometryRequest[] = [];
  terminate = vi.fn();
  postMessage(data: GeometryRequest) {
    this.messages.push(data);
  }
  constructor() {
    FakeWorker.instances.push(this);
  }
  respond(value: GeometryResponse) {
    this.onmessage?.({ data: value } as MessageEvent<GeometryResponse>);
  }
}
afterEach(() => {
  clearDrawingGeometryWorkers();
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
});
const turn = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("drawing geometry worker lifecycle", () => {
  it("copies large pages in small batches, returns Maps, and releases the snap worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const segments = Array.from({ length: 4500 }, () => ({
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
    }));
    const result = buildDrawingSnapIndex(segments, 0.5);
    const worker = FakeWorker.instances[0]!;
    for (let i = 0; i < 3; i++) {
      const message = worker.messages[i]!;
      expect(message.kind).toBe("snap-chunk");
      if (message.kind === "snap-chunk")
        expect(message.segments.length).toBeLessThanOrEqual(2000);
      worker.respond({ id: message.id, ok: true, value: null });
      await turn();
    }
    const index = buildSnapIndex(mergeCollinear(segments, 0.5), 0.5);
    worker.respond({ id: worker.messages[3]!.id, ok: true, value: index });
    expect(await result).toEqual(index);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("terminates CPU work when the sheet request is aborted", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const result = buildDrawingSnapIndex([], 0.5, controller.signal);
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
  it("terminates private sessions and rejects pending selections on account changes", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const pending = createPipeGeometrySession({
      segments: [],
      labels: [],
      aspect: 0.5,
      truncated: false,
    });
    const worker = FakeWorker.instances[0]!;
    worker.respond({ id: worker.messages[0]!.id, ok: true, value: null });
    await turn();
    worker.respond({
      id: worker.messages[1]!.id,
      ok: true,
      value: { layerCodes: [], codes: ["ST"], hasLines: true },
    });
    const session = await pending;
    const selection = session.select({ x: 0.5, y: 0.5 }, 0.01);
    const rejection = expect(selection).rejects.toMatchObject({
      name: "AbortError",
    });
    clearDrawingGeometryWorkers();
    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(
      session.select({ x: 0.5, y: 0.5 }, 0.01),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("preserves snap geometry in the compatibility fallback and closes fallback pipe sessions", async () => {
    vi.stubGlobal("Worker", undefined);
    const segments = [
      { x1: 0, y1: 0.2, x2: 0.4, y2: 0.2 },
      { x1: 0.6, y1: 0.2, x2: 1, y2: 0.2 },
    ];
    expect(await buildDrawingSnapIndex(segments, 0.5)).toEqual(
      buildSnapIndex(mergeCollinear(segments, 0.5), 0.5),
    );
    const session = await createPipeGeometrySession({
      segments: [],
      labels: [],
      aspect: 0.5,
      truncated: false,
    });
    clearDrawingGeometryWorkers();
    await expect(
      session.select({ x: 0.5, y: 0.5 }, 0.01),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("reports a worker failure without leaving a pending operation", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const result = buildDrawingSnapIndex([], 0.5);
    const rejection = expect(result).rejects.toThrow("worker stopped");
    FakeWorker.instances[0]!.onerror?.();
    await rejection;
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  });
});

it('keeps component analysis in the owning worker and rejects it on logout',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const pending=createPipeGeometrySession({segments:[],labels:[],symbols:[],texts:[],componentDataVersion:1,aspect:1,truncated:false});
 const worker=FakeWorker.instances[0]!;
 worker.respond({id:worker.messages[0]!.id,ok:true,value:null});await turn();
 worker.respond({id:worker.messages[1]!.id,ok:true,value:{layerCodes:['DCW'],codes:['DCW'],hasLines:true}});
 const session=await pending;
 const analysis=session.components([]);
 expect(worker.messages.at(-1)).toMatchObject({kind:'pipe-components',templates:[]});
 const rejection=expect(analysis).rejects.toMatchObject({name:'AbortError'});
 clearDrawingGeometryWorkers();await rejection;
 expect(worker.terminate).toHaveBeenCalledOnce();
});
