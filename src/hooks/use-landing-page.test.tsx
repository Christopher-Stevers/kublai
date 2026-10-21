import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLandingPage } from "./use-landing-page";
import { makeSnapshotSource, readSnapshotState } from "~/lib/snapshot-source";
const orders = makeSnapshotSource("/dashboard/orders", { version: 1 }, "Orders");
const alma = makeSnapshotSource("/dashboard/jobs/0391aed4-7773-47ec-9141-09df373ec008", { version: 1 }, "Alma Phase #2");
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("defaults to Jobs, shares captured destinations across consumers and persists", () => {
  const settings = renderHook(() => useLandingPage("tim"));
  const header = renderHook(() => useLandingPage("tim"));
  expect(header.result.current.landingPage).toBe("/dashboard");
  act(() => { settings.result.current.setLandingPage(orders); });
  expect(header.result.current.source).toEqual(orders);
  header.unmount();
  expect(renderHook(() => useLandingPage("tim")).result.current.source).toEqual(orders);
});
it("isolates accounts and rejects external destinations", () => {
  const view = renderHook(({ id }) => useLandingPage(id), { initialProps: { id: "tim" } });
  act(() => { view.result.current.setLandingPage(orders); });
  act(() => { view.result.current.setLandingPage({ ...orders, href: "https://example.com" }); });
  expect(view.result.current.source).toEqual(orders);
  view.rerender({ id: "diego" });
  expect(view.result.current.landingPage).toBe("/dashboard");
  view.rerender({ id: "tim" });
  expect(view.result.current.source).toEqual(orders);
});
it("uses an invite's default until the user chooses a destination", () => {
  const view = renderHook(() => useLandingPage("new-member", alma));
  expect(view.result.current.source).toEqual(alma);
  act(() => { view.result.current.setLandingPage(orders); });
  expect(view.result.current.source).toEqual(orders);
  act(() => { view.result.current.setLandingPage(null); });
  expect(view.result.current.source).toEqual(alma);
});

it("opens old account and device job destinations in the current workspace", () => {
  const view = renderHook(() => useLandingPage("tim", alma));
  const checkDestination = () => {
    const url = new URL(view.result.current.landingPage, "https://app.test");
    expect(url.pathname).toBe("/dashboard");
    expect(readSnapshotState(url.hash)?.workspace).toEqual({
      jobId: "0391aed4-7773-47ec-9141-09df373ec008", view: "options", materialListId: null,
    });
  };
  checkDestination();
  act(() => { view.result.current.setLandingPage(alma); });
  checkDestination();
  expect(view.result.current.source).toEqual(alma);
});

it("preserves custom drawing, document and other nested destinations", () => {
  const view = renderHook(() => useLandingPage("tim"));
  for (const href of ["/dashboard/orders", `${alma.href.split("#")[0]}/drawings?drawingSheet=sheet`, `${alma.href.split("#")[0]}/documents?document=doc`]) {
    const destination = makeSnapshotSource(href, { version: 1 }, "Custom destination");
    act(() => { view.result.current.setLandingPage(destination); });
    expect(view.result.current.landingPage).toBe(destination.href);
  }
});
