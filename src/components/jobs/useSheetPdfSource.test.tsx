import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { clearSheetPdfSources } from "~/lib/drawing-page-pdf";
import { useSheetPdfSource } from "./useSheetPdfSource";

const base =
  "/api/job-rooms/files/0391aed4-7773-47ec-9141-09df373ec008/b06815cb-ebac-42e0-8521-db654e9cad60";
const plan = `${base}/plan.pdf`;

afterEach(() => {
  cleanup();
  clearSheetPdfSources();
  vi.unstubAllGlobals();
});

it("is unknown until the set has answered, then follows the sheet", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        v: 1,
        pages: [
          { pdf: 500, image: 900 },
          { pdf: null, image: 900 },
        ],
      }),
    ),
  );
  const view = renderHook(
    ({ page }: { page: number }) => useSheetPdfSource({ url: plan, page }),
    { initialProps: { page: 1 } },
  );
  expect(view.result.current).toBeNull();
  await waitFor(() =>
    expect(view.result.current).toMatchObject({
      url: `${base}/pages/1.pdf`,
      page: 1,
      pdfBytes: 500,
    }),
  );
  // The last sheet's answer is never used for the next sheet.
  view.rerender({ page: 2 });
  expect(view.result.current).toBeNull();
  await waitFor(() =>
    expect(view.result.current).toEqual({ url: plan, page: 2 }),
  );
});

it("answers at once for a PDF that has no page files", () => {
  const fetched = vi.fn();
  vi.stubGlobal("fetch", fetched);
  const view = renderHook(() =>
    useSheetPdfSource({ url: "blob:https://app/1", page: 3 }),
  );
  expect(view.result.current).toEqual({ url: "blob:https://app/1", page: 3 });
  expect(renderHook(() => useSheetPdfSource(null)).result.current).toBeNull();
  expect(fetched).not.toHaveBeenCalled();
});
