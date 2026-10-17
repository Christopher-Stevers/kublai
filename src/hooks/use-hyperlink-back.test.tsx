import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  rememberHyperlinkSource,
  useHyperlinkBack,
} from "./use-hyperlink-back";
import {
  runHeaderBackOverride,
  useHeaderBackOverride,
} from "~/lib/header-back-events";
import { DRAWING_DESTINATION_EVENT } from "~/lib/snapshot-source";
const { replace, router } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace } };
});
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));
afterEach(async () => {
  cleanup();
  await tick();
  vi.restoreAllMocks();
  replace.mockReset();
});
it("returns through chained hyperlink sources, restores drawing state, then releases to the hierarchy", () => {
  const up = vi.fn(),
    event = vi.fn();
  window.addEventListener(DRAWING_DESTINATION_EVENT, event);
  renderHook(() => useHeaderBackOverride(up));
  const hook = renderHook(({ path }) => useHyperlinkBack(path, "account"), {
    initialProps: { path: "/dashboard/jobs/a/drawings" },
  });
  const source =
    "/dashboard/jobs/a/drawings?drawingSheet=a#snapshot=saved-position";
  act(() => rememberHyperlinkSource(source, "/dashboard/jobs/b/drawings"));
  hook.rerender({ path: "/dashboard/jobs/b/drawings" });
  act(() =>
    rememberHyperlinkSource(
      "/dashboard/jobs/b/drawings#snapshot=b",
      "/dashboard/jobs/b/documents",
    ),
  );
  hook.rerender({ path: "/dashboard/jobs/b/documents" });
  act(() => runHeaderBackOverride());
  expect(replace).toHaveBeenLastCalledWith(
    "/dashboard/jobs/b/drawings#snapshot=b",
    { scroll: false },
  );
  hook.rerender({ path: "/dashboard/jobs/b/drawings" });
  act(() => runHeaderBackOverride());
  expect(replace).toHaveBeenLastCalledWith(source, { scroll: false });
  expect(event).toHaveBeenLastCalledWith(
    expect.objectContaining({ detail: new URL(source, location.origin).href }),
  );
  act(() => runHeaderBackOverride());
  expect(up).toHaveBeenCalledOnce();
  window.removeEventListener(DRAWING_DESTINATION_EVENT, event);
});
it("phone/browser Back consumes a hyperlink parent through the shared hierarchy guard", async () => {
  renderHook(() => useHyperlinkBack("/dashboard/jobs/a/drawings", "account"));
  act(() =>
    rememberHyperlinkSource(
      "/dashboard/jobs/a/drawings#source",
      "/dashboard/jobs/a/drawings#target",
    ),
  );
  await tick();
  await act(async () => {
    window.history.replaceState({}, "");
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  });
  expect(replace).toHaveBeenCalledExactlyOnceWith(
    "/dashboard/jobs/a/drawings#source",
    { scroll: false },
  );
});
it("clears temporary parents when leaving the visit or changing accounts and ignores external links", () => {
  const hook = renderHook(
    ({ path, account }) => useHyperlinkBack(path, account),
    { initialProps: { path: "/dashboard/jobs/a/drawings", account: "one" } },
  );
  act(() =>
    rememberHyperlinkSource(
      "/dashboard/jobs/a/drawings",
      "https://example.com",
    ),
  );
  expect(hook.result.current).toBe(false);
  act(() =>
    rememberHyperlinkSource(
      "/dashboard/jobs/a/drawings",
      "/dashboard/jobs/a/documents",
    ),
  );
  hook.rerender({ path: "/dashboard/orders", account: "one" });
  expect(hook.result.current).toBe(false);
  act(() =>
    rememberHyperlinkSource("/dashboard/orders", "/dashboard/jobs/a/documents"),
  );
  hook.rerender({ path: "/dashboard/jobs/a/documents", account: "two" });
  expect(hook.result.current).toBe(false);
});
