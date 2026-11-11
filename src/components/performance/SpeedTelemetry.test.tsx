import { navigationPaint, setLocalNavigationScreen } from "~/lib/navigation-paint";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SpeedTelemetry } from "./SpeedTelemetry";

type Vital = { value: number; entries: { startTime: number }[] };
const state = vi.hoisted(() => ({
  path: "/jobs/material-lists/fixture",
  inp: undefined as undefined | ((metric: Vital) => void),
  lcp: undefined as undefined | ((metric: Vital) => void),
}));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("web-vitals", () => ({
  onINP: (callback: (metric: Vital) => void) => {
    state.inp = callback;
  },
  onLCP: (callback: (metric: Vital) => void) => {
    state.lcp = callback;
  },
}));
const originalBeacon = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
afterEach(() => {
  cleanup();
  navigationPaint.cancel();
  setLocalNavigationScreen(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalBeacon)
    Object.defineProperty(navigator, "sendBeacon", originalBeacon);
  else Reflect.deleteProperty(navigator, "sendBeacon");
  history.replaceState(null, "", "/");
});

it("sends a delayed final vital with its observed interaction context across SPA navigation", async () => {
  vi.stubGlobal("PerformanceObserver", { supportedEntryTypes: [] });
  const now = vi.spyOn(performance, "now").mockReturnValue(100);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const beacon = vi.fn((_url: string, _body: Blob) => true);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: beacon,
  });
  history.replaceState(null, "", state.path);
  const view = render(<SpeedTelemetry />);
  state.path = "/jobs/fixture";
  now.mockReturnValue(300);
  history.replaceState(null, "", state.path);
  view.rerender(<SpeedTelemetry />);
  act(() => {
    state.inp?.({ value: 120, entries: [{ startTime: 200 }] });
    window.dispatchEvent(new Event("pagehide"));
  });
  expect(beacon).toHaveBeenCalledOnce();
  const body = beacon.mock.calls[0]?.[1];
  if (!body) throw new Error("Missing numeric telemetry payload");
  const json = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Expected text in test beacon"));
    };
    reader.onerror = () => reject(new Error("Unable to read test beacon"));
    reader.readAsText(body);
  });
  const payload: unknown = JSON.parse(json);
  expect(payload).toMatchObject({
    screen: "materials",
    metrics: [{ name: "inp", durationMs: 120 }],
  });
  view.unmount();
  act(() => {
    state.inp?.({ value: 300, entries: [{ startTime: 400 }] });
  });
  expect(beacon).toHaveBeenCalledOnce();
});

it("attributes delayed INP to the local allowlisted screen at input time without sending workspace identities", async () => {
  vi.stubGlobal("PerformanceObserver", {supportedEntryTypes: []});
  const now = vi.spyOn(performance, "now").mockReturnValue(100);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const beacon = vi.fn((_url: string, _body: Blob) => true);
  Object.defineProperty(navigator, "sendBeacon", {configurable: true, value: beacon});
  state.path = "/jobs"; history.replaceState(null, "", state.path); render(<SpeedTelemetry />);
  now.mockReturnValue(200); act(() => setLocalNavigationScreen("materials"));
  now.mockReturnValue(400); act(() => setLocalNavigationScreen("chat"));
  act(() => {state.inp?.({value: 75, entries: [{startTime: 300}]}); window.dispatchEvent(new Event("pagehide"));});
  expect(beacon).toHaveBeenCalledOnce();
  const body = beacon.mock.calls[0]?.[1]; if (!body) throw Error("Missing field payload");
  const text = await new Promise<string>((resolve, reject) => {const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(Error("Expected text")); reader.onerror = reject; reader.readAsText(body);});
  expect(JSON.parse(text) as unknown).toMatchObject({screen: "materials", metrics: [{name: "inp", durationMs: 75}]});
  expect(text).not.toContain("private");
});
