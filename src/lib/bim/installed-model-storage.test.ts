import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});
async function setup(standalone: boolean, ios = false) {
  vi.stubGlobal("matchMedia", () => ({ matches: standalone }));
  const persist = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("navigator", {
    standalone: ios,
    storage: { persisted: vi.fn().mockResolvedValue(false), persist },
  });
  const { installedModelStorage } = await import("./installed-model-storage");
  return { installedModelStorage, persist };
}
it("does not request persistence in a normal browser tab", async () => {
  const { installedModelStorage, persist } = await setup(false);
  expect(installedModelStorage()).toBe(false);
  expect(persist).not.toHaveBeenCalled();
});
it.each([false, true])(
  "requests persistence once in an installed app (iOS: %s)",
  async (ios) => {
    const { installedModelStorage, persist } = await setup(!ios, ios);
    expect(installedModelStorage()).toBe(true);
    expect(installedModelStorage()).toBe(true);
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  },
);
it("keeps viewing available when persistence is refused", async () => {
  const { installedModelStorage, persist } = await setup(true);
  persist.mockRejectedValue(new Error("Denied"));
  expect(installedModelStorage()).toBe(true);
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
});
