import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePipeLegendAnalysis } from "./usePipeLegendAnalysis";
import type { PipeSystemSelection } from "~/lib/pipe-system";
import type { PipeLegendReferences } from "~/lib/pipe-components-types";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const selection = { segments: [{ id: "one" }] } as PipeSystemSelection;
it("automatically loads saved references then analyzes the selected line", async () => {
  const load = vi
    .fn()
    .mockResolvedValue({ templates: [], warnings: ["No saved references"] });
  const analyze = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    usePipeLegendAnalysis({
      active: true,
      source: "one",
      selection,
      templates: [],
      load,
      analyze,
    }),
  );
  await waitFor(() => expect(analyze).toHaveBeenCalledOnce());
  expect(result.current.warnings).toEqual(["No saved references"]);
  act(() => result.current.recheck());
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
});
it("ignores an old legend response after switching drawings or selections", async () => {
  let resolve!: (result: PipeLegendReferences) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<PipeLegendReferences>((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ templates: [], warnings: [] });
  const analyze = vi.fn().mockResolvedValue(undefined);
  const { rerender } = renderHook(
    ({ source }) =>
      usePipeLegendAnalysis({
        active: true,
        source,
        selection,
        templates: [],
        load,
        analyze,
      }),
    { initialProps: { source: "old" } },
  );
  rerender({ source: "new" });
  await waitFor(() => expect(analyze).toHaveBeenCalledOnce());
  await act(async () => resolve({ templates: [], warnings: [] }));
  expect(analyze).toHaveBeenCalledOnce();
});
it("reports unavailable references without silently claiming legend identification", async () => {
  const analyze = vi.fn(),
    load = vi.fn().mockRejectedValue(new Error("Offline"));
  const { result } = renderHook(() =>
    usePipeLegendAnalysis({
      active: true,
      source: "one",
      selection,
      templates: [],
      load,
      analyze,
    }),
  );
  await waitFor(() =>
    expect(result.current.error).toMatch(/Retrying automatically/),
  );
  expect(analyze).not.toHaveBeenCalled();
});

it("retries a temporary legend outage and runs detection without selecting again", async () => {
  vi.useFakeTimers();
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("HTTP 502"))
    .mockResolvedValue({ templates: [], warnings: [] });
  const analyze = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    usePipeLegendAnalysis({
      active: true,
      source: "one",
      selection,
      templates: [],
      load,
      analyze,
    }),
  );
  await act(async () => { await Promise.resolve(); });
  expect(result.current.error).toMatch(/Retrying automatically/);
  expect(analyze).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(load).toHaveBeenCalledTimes(2);
  expect(analyze).toHaveBeenCalledOnce();
  expect(result.current.error).toBeNull();
});

it("bounds retries, then recovers when connectivity returns", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockRejectedValue(new Error("Offline"));
  const analyze = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    usePipeLegendAnalysis({
      active: true,
      source: "one",
      selection,
      templates: [],
      load,
      analyze,
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200_000);
  });
  expect(load).toHaveBeenCalledTimes(6);
  expect(result.current.error).toMatch(/could not be loaded/);
  load.mockResolvedValue({ templates: [], warnings: [] });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect(analyze).toHaveBeenCalledOnce();
  expect(result.current.error).toBeNull();
});

it("cancels pending retries when leaving pipe mode", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockRejectedValue(new Error("Offline"));
  const analyze = vi.fn();
  const { rerender } = renderHook(
    ({ active }) =>
      usePipeLegendAnalysis({
        active,
        source: "one",
        selection,
        templates: [],
        load,
        analyze,
      }),
    { initialProps: { active: true } },
  );
  await act(async () => { await Promise.resolve(); });
  rerender({ active: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200_000);
    window.dispatchEvent(new Event("online"));
  });
  expect(load).toHaveBeenCalledOnce();
  expect(analyze).not.toHaveBeenCalled();
});

it("does not retry a denied legend request", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockRejectedValue({ data: { httpStatus: 403 } });
  const analyze = vi.fn();
  renderHook(() =>
    usePipeLegendAnalysis({
      active: true,
      source: "one",
      selection,
      templates: [],
      load,
      analyze,
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200_000);
    window.dispatchEvent(new Event("focus"));
  });
  expect(load).toHaveBeenCalledOnce();
  expect(analyze).not.toHaveBeenCalled();
});
