import { afterEach, expect, it, vi } from "vitest";
import { updateAppBadge } from "./app-badge";
afterEach(() => vi.unstubAllGlobals());
it("sets unread counts and clears a fully read inbox", async () => {
  const setAppBadge = vi.fn(), clearAppBadge = vi.fn();
  vi.stubGlobal("navigator", {setAppBadge, clearAppBadge});
  await updateAppBadge(3);
  expect(setAppBadge).toHaveBeenCalledWith(3);
  await updateAppBadge(0);
  expect(clearAppBadge).toHaveBeenCalledOnce();
});
it("ignores invalid counts and unavailable or rejected badge support", async () => {
  vi.stubGlobal("navigator", {});
  await expect(updateAppBadge(1)).resolves.toBeUndefined();
  const setAppBadge = vi.fn().mockRejectedValue(new Error("Disabled"));
  vi.stubGlobal("navigator", {setAppBadge});
  await updateAppBadge(-1);
  expect(setAppBadge).not.toHaveBeenCalled();
  await expect(updateAppBadge(1)).resolves.toBeUndefined();
});
