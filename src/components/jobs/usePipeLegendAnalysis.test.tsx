import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePipeLegendAnalysis } from "./usePipeLegendAnalysis";
import type { PipeSystemSelection } from "~/lib/pipe-system";
import type { PipeLegendReferences } from "~/lib/pipe-components-types";
afterEach(cleanup);
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
    expect(result.current.error).toMatch(/could not be loaded/),
  );
  expect(analyze).not.toHaveBeenCalled();
});
