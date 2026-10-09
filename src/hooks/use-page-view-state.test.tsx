import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { makeSnapshotSource, type PageViewValue } from "~/lib/snapshot-source";
import { usePageViewState } from "./use-page-view-state";
beforeEach(() => window.history.replaceState({}, "", "/dashboard"));
afterEach(cleanup);
it("restores filters, validates enum values, and keeps different job states separate", () => {
  const href = makeSnapshotSource(
    "/dashboard",
    {
      version: 1,
      pages: {
        "job:one:query": "valve",
        "job:two:query": "pump",
        tab: "unknown",
      },
    },
    "Jobs",
  ).href;
  window.history.replaceState({}, "", href);
  const filter = renderHook(
    ({ job }) => usePageViewState(`job:${job}:query`, ""),
    { initialProps: { job: "one" } },
  );
  expect(filter.result.current[0]).toBe("valve");
  filter.rerender({ job: "two" });
  expect(filter.result.current[0]).toBe("pump");
  const tab = renderHook(() =>
    usePageViewState("tab", "files", ["files", "reviews"]),
  );
  expect(tab.result.current[0]).toBe("files");
});
it("captures live values and unregisters them when the page closes", () => {
  let read!: () => PageViewValue;
  const unregister = vi.fn();
  const registerPage = vi.fn((_key, reader: () => PageViewValue) => {
    read = reader;
    return unregister;
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SnapshotSourceContext.Provider
      value={{
        registerPage,
        register: () => () => undefined,
        captureSource: vi.fn(),
      }}
    >
      {children}
    </SnapshotSourceContext.Provider>
  );
  const view = renderHook(() => usePageViewState("query", ""), { wrapper });
  act(() => view.result.current[1]("updated filter"));
  expect(read()).toBe("updated filter");
  view.unmount();
  expect(unregister).toHaveBeenCalledOnce();
});
