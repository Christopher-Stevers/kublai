import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { scan, save, update, refetch } = vi.hoisted(() => ({
  scan: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: null }) }));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: {
      legendItems: {
        useQuery: () => ({
          data: {
            items: [],
            canEdit: true,
            sheets: [
              {
                id: "sheet",
                name: "M-001",
                imageUrl: "/sheet.webp",
                width: 1000,
                height: 750,
              },
              {
                id: "sheet2",
                name: "M-002",
                imageUrl: "/sheet2.webp",
                width: 1000,
                height: 750,
              },
            ],
          },
          refetch,
        }),
      },
      scanLegend: {
        useMutation: () => ({ mutateAsync: scan, isPending: false }),
      },
      saveLegendItems: {
        useMutation: () => ({ mutateAsync: save, isPending: false }),
      },
      updateLegendItem: {
        useMutation: () => ({ mutateAsync: update, isPending: false }),
      },
    },
  },
}));
import { LegendItemsDialog } from "./LegendItemsDialog";
const row = { left: 0.1, top: 0.1, right: 0.4, bottom: 0.2 };
beforeEach(() => {
  vi.clearAllMocks();
  scan.mockResolvedValue({
    items: [
      {
        name: "Circuit balancing valve",
        abbreviation: "CBV",
        category: "Mechanical",
        row,
        symbol: { ...row, right: 0.18 },
      },
    ],
    warning: "Review before saving.",
  });
  save.mockResolvedValue({ added: 1, existing: 0 });
  refetch.mockResolvedValue({});
});
afterEach(cleanup);
it("reads proposals without saving, then saves the user's corrected selection", async () => {
  render(
    <LegendItemsDialog
      sheetId="sheet"
      sourceId="sheet"
      onClose={vi.fn()}
      onSource={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read legend" }));
  await screen.findByDisplayValue("Circuit balancing valve");
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Component name"), {
    target: { value: "Balancing valve" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save selected (1)" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSheetId: "sheet",
        items: [
          expect.objectContaining({
            name: "Balancing valve",
            abbreviation: "CBV",
          }),
        ],
      }),
    ),
  );
  expect(await screen.findByText("1 legend items saved.")).toBeInTheDocument();
});
it("allows excluding detections and surfaces scan failures", async () => {
  render(
    <LegendItemsDialog
      sheetId="sheet"
      sourceId="sheet"
      onClose={vi.fn()}
      onSource={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read legend" }));
  await screen.findByDisplayValue("Circuit balancing valve");
  fireEvent.click(screen.getByRole("button", { name: "Select none" }));
  expect(
    screen.getByRole("button", { name: "Save selected (0)" }),
  ).toBeDisabled();
  scan.mockRejectedValueOnce(new Error("Original PDF unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Read legend" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Original PDF unavailable",
  );
});

it("scans a whole set, keeps each source and preserves corrected candidates on rescans", async () => {
  render(
    <LegendItemsDialog
      sheetId="sheet"
      sourceId="sheet"
      onClose={vi.fn()}
      onSource={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText("Recognize scanned text"));
  fireEvent.click(screen.getByRole("button", { name: "Read entire set" }));
  await waitFor(() =>
    expect(screen.getAllByDisplayValue("Circuit balancing valve")).toHaveLength(
      2,
    ),
  );
  expect(
    scan.mock.calls.map(([v]) => [v.sourceSheetId, v.recognizeText]),
  ).toEqual([
    ["sheet", true],
    ["sheet2", true],
  ]);
  fireEvent.change(screen.getAllByLabelText("Component name")[0]!, {
    target: { value: "Reviewed valve" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Read entire set" }));
  await waitFor(() => expect(scan).toHaveBeenCalledTimes(4));
  expect(screen.getByDisplayValue("Reviewed valve")).toBeInTheDocument();
  expect(screen.getAllByLabelText("Component name")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Save selected (2)" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls.map(([v]) => v.sourceSheetId)).toEqual([
    "sheet",
    "sheet2",
  ]);
});
