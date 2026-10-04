import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useJobWorkspaceNavigation } from "./use-job-workspace-navigation";

vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => ({ runId: "practice" }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("uses normal back/navigation in memory without reading or changing real workspace history", () => {
  const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  const push = vi.spyOn(window.history, "pushState"),
    replace = vi.spyOn(window.history, "replaceState"),
    back = vi.spyOn(window.history, "back");
  const { result } = renderHook(() => useJobWorkspaceNavigation());
  expect(result.current.location).toBeNull();
  act(() =>
    result.current.navigate({
      jobId: "demo",
      view: "options",
      materialListId: null,
    }),
  );
  act(() =>
    result.current.navigate({
      jobId: "demo",
      view: "material-lists",
      materialListId: "practice-list",
    }),
  );
  expect(result.current.location?.materialListId).toBe("practice-list");
  act(() => result.current.back());
  expect(result.current.location?.view).toBe("options");
  act(() => result.current.back());
  expect(result.current.location).toBeNull();
  expect(push).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  expect(back).not.toHaveBeenCalled();
  expect(storage.getItem).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.removeItem).not.toHaveBeenCalled();
});
