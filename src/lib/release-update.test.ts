import { describe, expect, it } from "vitest";
import { goodUpdateLink, quietForRelease, reloadReleaseOnce, isChunkFailure } from "./release-update";
describe("release update policy", () => {
  it("does not warm on unknown, offline, saving-data or weak links", () => {
    expect(goodUpdateLink(true, {effectiveType:"4g",downlink:10})).toBe(true);
    for (const [online, connection] of [[false,{effectiveType:"4g"}],[true,undefined],[true,{effectiveType:"3g"}],[true,{effectiveType:"4g",saveData:true}],[true,{effectiveType:"4g",downlink:0.5}]] as const)
      expect(goodUpdateLink(online,connection)).toBe(false);
  });
  it("waits for five quiet seconds and protects edits/pending writes", () => {
    expect(quietForRelease(6000,0,0,false)).toBe(true);
    expect(quietForRelease(4999,0,0,false)).toBe(false);
    expect(quietForRelease(6000,0,1,false)).toBe(false);
    expect(quietForRelease(6000,0,0,true)).toBe(false);
  });
  it("reloads once per explicit build without changing the current location", () => {
    const values = new Map<string,string>();let reloads=0;
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    expect(reloadReleaseOnce("a".repeat(64),storage,()=>reloads++)).toBe(true);
    expect(reloadReleaseOnce("a".repeat(64),storage,()=>reloads++)).toBe(false);
    expect(reloadReleaseOnce("unknown",storage,()=>reloads++)).toBe(false);
    expect(reloadReleaseOnce("b".repeat(64),{...storage,setItem:()=>{throw Error("blocked");}},()=>reloads++)).toBe(false);
    expect(reloads).toBe(1);
    expect(isChunkFailure("ChunkLoadError: Loading chunk 12 failed")).toBe(true);
    expect(isChunkFailure("payment rejected")).toBe(false);
  });
});
