import { afterEach, beforeEach, expect, it, vi } from "vitest";
function gate() {
  let release: () => void = () => undefined;
  const waiting = new Promise<void>(resolve => {release = resolve;});
  return {waiting, release: () => release()};
}
beforeEach(()=>{vi.resetModules();vi.stubGlobal("Worker",undefined);});
afterEach(async()=>{
  (await import("./drawing-geometry-client")).clearDrawingGeometryWorkers();
  vi.doUnmock("./drawing-geometry-fallback");vi.unstubAllGlobals();vi.restoreAllMocks();
});
it("does not start fallback computation after an abort during module loading",async()=>{
  const loading=gate();const compute=vi.fn();
  vi.doMock("./drawing-geometry-fallback",async()=>{await loading.waiting;return {buildFallbackSnapIndex:compute,createFallbackPipeSession:vi.fn()};});
  const client=await import("./drawing-geometry-client");
  const controller=new AbortController();
  const pending=client.buildDrawingSnapIndex([],1,controller.signal);
  const rejected=expect(pending).rejects.toMatchObject({name:"AbortError"});
  controller.abort();await rejected;loading.release();
  expect(compute).not.toHaveBeenCalled();
});
it("account clear fences both snap and pipe imports before a session can be registered",async()=>{
  const loading=gate();const snap=vi.fn(),pipe=vi.fn();
  vi.doMock("./drawing-geometry-fallback",async()=>{await loading.waiting;return {buildFallbackSnapIndex:snap,createFallbackPipeSession:pipe};});
  const client=await import("./drawing-geometry-client");
  const snapRejected=expect(client.buildDrawingSnapIndex([],1)).rejects.toMatchObject({name:"AbortError"});
  const pipeRejected=expect(client.createPipeGeometrySession({segments:[],labels:[],aspect:1,truncated:false})).rejects.toMatchObject({name:"AbortError"});
  client.clearDrawingGeometryWorkers();await Promise.all([snapRejected,pipeRejected]);loading.release();
  expect(snap).not.toHaveBeenCalled();expect(pipe).not.toHaveBeenCalled();
});
it("cleans the import lease's abort listener if loading fails",async()=>{
  vi.doMock("./drawing-geometry-fallback",()=>{throw new Error("Module unavailable");});
  const client=await import("./drawing-geometry-client");
  const controller=new AbortController();const removed=vi.spyOn(controller.signal,"removeEventListener");
  await expect(client.buildDrawingSnapIndex([],1,controller.signal)).rejects.toThrow();
  expect(removed).toHaveBeenCalledWith("abort",expect.any(Function));
  expect(()=>client.clearDrawingGeometryWorkers()).not.toThrow();
});
