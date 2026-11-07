// @vitest-environment node
import { expect, it } from "vitest";
import vm from "node:vm";
import { OFFLINE_TEST_BOOT_SCRIPT } from "./offline-test-document";
it("makes existing online checks follow the offline switch before app initialization", () => {
  let value = "0";
  class Navigator {
    get onLine() {
      return true;
    }
  }
  const navigator = new Navigator();
  const listeners = new Map<string, () => void>();
  let reloads = 0;
  vm.runInNewContext(OFFLINE_TEST_BOOT_SCRIPT, {
    Navigator,
    navigator,
    localStorage: { getItem: () => value },
    window: {
      addEventListener: (name: string, fn: () => void) =>
        listeners.set(name, fn),
    },
    location: { reload: () => reloads++ },
  });
  expect(navigator.onLine).toBe(true);
  value = "1";
  expect(navigator.onLine).toBe(false);
  (listeners.get("storage") as unknown as (e: { key: string }) => void)({
    key: "foremanhq.offline-test",
  });
  expect(reloads).toBe(1);
  value = "0";
  expect(navigator.onLine).toBe(true);
});
