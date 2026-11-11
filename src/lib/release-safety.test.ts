import { expect, it } from "vitest";
import { holdReleaseWork, registerReleaseCheck, releaseWorkPending } from "./release-safety";
it("keeps uploads/CPU work and durable queue checks ahead of automatic reload, failing closed", async () => {
  const finish=holdReleaseWork();expect(await releaseWorkPending()).toBe(true);
  finish();expect(await releaseWorkPending()).toBe(false);
  let queued=true;registerReleaseCheck(async()=>queued);
  expect(await releaseWorkPending()).toBe(true);
  queued=false;expect(await releaseWorkPending()).toBe(false);
  registerReleaseCheck(()=>{throw Error("Storage unavailable");});
  expect(await releaseWorkPending()).toBe(true);
});
