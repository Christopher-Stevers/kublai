import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { vi, it, expect, afterEach, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  query: vi.fn(),
  ocr: vi.fn(),
  refetch: vi.fn(),
  export: vi.fn(),
  data: {
    lines: [] as unknown[],
    warnings: [] as string[],
    pending: 0,
    ocr: [] as unknown[],
    generatedAt: "2026-10-26T04:00:00Z",
    coverage: { sheets: 1, totalSheets: 1, documents: 1, totalDocuments: 1 },
  },
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: {
      superEquipmentSources: {
        useQuery: () => ({
          data: {
            documents: [
              {
                id: "doc",
                name: "Pump submittal",
                folder: "Submittals",
                version: 1,
                submittal: true,
              },
            ],
            sheets: 1,
          },
        }),
      },
      superEquipmentReport: {
        useQuery: (input: unknown) => {
          state.query(input);
          return {
            data: state.data,
            refetch: state.refetch,
            isFetching: false,
          };
        },
      },
      recognizeEquipmentSource: {
        useMutation: () => ({ mutateAsync: state.ocr }),
      },
    },
  },
}));
vi.mock("~/lib/download-report", () => ({ downloadReport: state.export }));
import { SuperEquipmentDialog } from "./SuperEquipmentDialog";
beforeEach(() => {
  vi.clearAllMocks();
  state.data.lines = [
    {
      id: "1",
      tag: "P-1",
      schedule: "Pump schedule",
      cells: ["150 GPM"],
      sheetId: "sheet",
      sheet: "M-001",
      set: "Mechanical",
      page: 1,
      sourceUrl: "/source-1",
      status: "matched",
      matches: [
        {
          documentId: "doc",
          name: "Pump submittal",
          version: 1,
          status: "draft",
          url: "/doc",
          pages: [1],
          reason: "Exact equipment tag",
          confirmed: true,
        },
      ],
    },
    {
      id: "2",
      tag: "P-2",
      schedule: "Pump schedule",
      cells: ["200 GPM"],
      sheetId: "sheet",
      sheet: "M-001",
      set: "Mechanical",
      page: 1,
      sourceUrl: "/source-2",
      status: "missing",
      matches: [],
    },
  ];
  state.data.ocr = [];
  state.ocr.mockResolvedValue({ ok: true });
  state.refetch.mockResolvedValue({});
});
afterEach(cleanup);
it("shows evidence and approval separately, filters results and exports the visible report", () => {
  render(
    <SuperEquipmentDialog sheetId="sheet" jobId="job" onClose={() => {}} />,
  );
  expect(screen.getByRole("heading", { name: "P-1" })).toBeInTheDocument();
  expect(screen.getByText(/draft · Pages 1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "1 No submittal found" }));
  expect(screen.queryByRole("heading", { name: "P-1" })).toBeNull();
  expect(screen.getByRole("heading", { name: "P-2" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Export report (1)" }));
  expect(state.export.mock.calls[0]![1]).toContain("P-2");
  expect(state.export.mock.calls[0]![1]).not.toContain("P-1");
});
it("applies source selection to the server request rather than filtering evidence in the browser", () => {
  render(
    <SuperEquipmentDialog sheetId="sheet" jobId="job" onClose={() => {}} />,
  );
  fireEvent.click(screen.getByText(/Submittal sources/));
  fireEvent.click(screen.getByRole("button", { name: "None" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply sources" }));
  expect(state.query).toHaveBeenLastCalledWith({
    sheetId: "sheet",
    documentIds: [],
  });
});
it("recognizes pages sequentially and refreshes the report afterward", async () => {
  state.data.ocr = [
    { kind: "drawing", id: "sheet", page: 1, name: "M-001" },
    { kind: "document", id: "doc", page: 2, name: "Pump submittal" },
  ];
  render(
    <SuperEquipmentDialog sheetId="sheet" jobId="job" onClose={() => {}} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Recognize scanned pages (2)" }),
  );
  await waitFor(() => expect(state.refetch).toHaveBeenCalledOnce());
  expect(state.ocr.mock.calls.map(([v]) => v.page)).toEqual([1, 2]);
});
