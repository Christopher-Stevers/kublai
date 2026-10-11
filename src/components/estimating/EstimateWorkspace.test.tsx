import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  newEstimateDocument,
  newEstimateLine,
  pricingRowSchema,
  type EstimateDocument,
  type EstimateAssembly,
  type EstimateRecord,
} from "~/lib/estimating";
import { confirmAction } from "~/components/ui/app-dialogs";
import { EstimateWorkspace } from "./EstimateWorkspace";
import { EstimatingAccess } from "./EstimatingAccess";
import { PricebookDialog } from "./PricebookDialog";

const fixtureState = vi.hoisted(() => ({
  record: null as EstimateRecord | null,
  permissions: {} as Record<string, boolean>,
  sheets: [] as {
    id: string;
    number: string;
    title: string;
    pageNumber: number;
    setId: string;
    revision: string;
  }[],
  pricing: {
    revision: 4,
    rows: [] as ReturnType<typeof pricingRowSchema.parse>[],
    assemblies: [] as EstimateAssembly[],
  },
}));
const methods = vi.hoisted(() => ({
  save: vi.fn(),
  analyze: vi.fn(),
  importList: vi.fn(),
  importPrefab: vi.fn(),
  refreshPricing: vi.fn(),
  changeStatus: vi.fn(),
  duplicate: vi.fn(),
  create: vi.fn(),
  restore: vi.fn(),
  handoff: vi.fn(),
  savePricing: vi.fn(),
  push: vi.fn(),
  setData: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: methods.push }),
}));
vi.mock("~/components/ui/app-dialogs", () => ({
  confirmAction: vi.fn(async () => true),
  notify: vi.fn(),
}));
vi.mock("~/trpc/react", () => {
  const result = (data: unknown) => ({
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: async () => ({ data }),
  });
  const mutation = (method: (...args: unknown[]) => unknown) => ({
    useMutation: () => ({ mutateAsync: method, isPending: false }),
  });
  const utils = {
    estimating: {
      get: { setData: methods.setData },
      list: { invalidate: methods.invalidate },
      history: { invalidate: methods.invalidate },
      pricing: { invalidate: methods.invalidate },
    },
  };
  return {
    api: {
      useUtils: () => utils,
      user: {
        getMyRole: {
          useQuery: () =>
            result({ permissions: { can: fixtureState.permissions } }),
        },
      },
      estimating: {
        get: { useQuery: () => result(fixtureState.record) },
        resources: {
          useQuery: () =>
            result({
              sheets: fixtureState.sheets,
              materialLists: [{ id: "list-id", name: "Plumbing rough-in" }],
              prefabs: [],
            }),
        },
        history: {
          useQuery: () => result({ items: [], nextBeforeRevision: null }),
        },
        catalogue: { useQuery: () => result([]) },
        pricing: { useQuery: () => result(fixtureState.pricing) },
        save: mutation(methods.save),
        analyzeDrawings: mutation(methods.analyze),
        importMaterialList: mutation(methods.importList),
        importPrefab: mutation(methods.importPrefab),
        applyPricing: mutation(methods.refreshPricing),
        setStatus: mutation(methods.changeStatus),
        duplicate: mutation(methods.duplicate),
        create: mutation(methods.create),
        restore: mutation(methods.restore),
        handoffMaterialList: mutation(methods.handoff),
        savePricing: mutation(methods.savePricing),
      },
    },
  };
});

const estimateId = "11111111-1111-4111-8111-111111111111";
function record(
  document = newEstimateDocument(),
  revision = 7,
): EstimateRecord {
  return {
    id: estimateId,
    jobId: "22222222-2222-4222-8222-222222222222",
    jobName: "Lakeview renovation",
    name: "Mechanical base bid",
    status: "draft",
    revision,
    document,
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-11T12:00:00Z",
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  for (const mock of Object.values(methods)) mock.mockReset();
  vi.mocked(confirmAction).mockReset().mockResolvedValue(true);
  fixtureState.permissions = {
    "financial.view": true,
    "tab.estimating": true,
    "estimating.edit": true,
    "estimating.approve": true,
    "drawings.view": true,
    "lists.edit": true,
  };
  const document = newEstimateDocument();
  document.lines = [
    newEstimateLine({
      id: "line-copper",
      description: "Copper pipe",
      quantity: 10,
      unit: "ft",
      materialUnitCost: 4,
      priceSource: "manual",
      reviewStatus: "approved",
    }),
  ];
  fixtureState.record = record(document);
  fixtureState.sheets = Array.from({ length: 6 }, (_, index) => ({
    id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
    number: `M${index + 1}`,
    title: "Mechanical plan",
    pageNumber: index + 1,
    setId: "44444444-4444-4444-8444-444444444444",
    revision: "3",
  }));
  fixtureState.pricing = {
    revision: 4,
    rows: [
      pricingRowSchema.parse({
        id: "rate-copper",
        description: "Copper pipe",
        materialUnitCost: 4,
        unit: "ft",
      }),
    ],
    assemblies: [],
  };
  methods.save.mockImplementation(
    async (input: {
      document: EstimateDocument;
      name?: string;
      expectedRevision: number;
    }) => ({
      ...fixtureState.record,
      name: input.name ?? fixtureState.record?.name,
      document: input.document,
      revision: input.expectedRevision + 1,
    }),
  );
  methods.invalidate.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("estimating workspace integrity", () => {
  it("never mounts financial workspace content without both permissions and removes it on revocation", () => {
    fixtureState.permissions["financial.view"] = false;
    const view = render(
      <EstimatingAccess>
        <EstimateWorkspace id={estimateId} />
      </EstimatingAccess>,
    );
    expect(screen.queryByLabelText("Estimate name")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("don’t have access");
    fixtureState.permissions["financial.view"] = true;
    view.rerender(
      <EstimatingAccess>
        <EstimateWorkspace id={estimateId} />
      </EstimatingAccess>,
    );
    expect(screen.getByLabelText("Estimate name")).toBeInTheDocument();
    fixtureState.permissions["tab.estimating"] = false;
    view.rerender(
      <EstimatingAccess>
        <EstimateWorkspace id={estimateId} />
      </EstimatingAccess>,
    );
    expect(screen.queryByLabelText("Estimate name")).not.toBeInTheDocument();
  });

  it("retains edited values on revision conflict and keeps exports disabled", async () => {
    methods.save.mockRejectedValueOnce(
      Object.assign(
        new Error(
          "This estimate changed by another user. Reload the current revision.",
        ),
        { data: { code: "CONFLICT" } },
      ),
    );
    render(<EstimateWorkspace id={estimateId} />);
    fireEvent.change(screen.getByLabelText("Quantity for Copper pipe"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("another user"),
    );
    expect(screen.getByLabelText("Quantity for Copper pipe")).toHaveValue(25);
    expect(methods.save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 7,
      }),
    );
    const attemptedSave = methods.save.mock.calls[0]?.[0] as {
      document: EstimateDocument;
    };
    expect(attemptedSave.document.lines[0]?.quantity).toBe(25);
    expect(
      screen.getByRole("button", { name: "Customer proposal · PDF" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save as new estimate" }),
    ).toBeInTheDocument();
    expect(methods.setData).toHaveBeenCalledTimes(1);
  });

  it("saves edits before import and uses the accepted revision for the import", async () => {
    methods.importList.mockImplementation(
      async (input: { expectedRevision: number }) =>
        record(fixtureState.record!.document, input.expectedRevision + 1),
    );
    render(<EstimateWorkspace id={estimateId} />);
    fireEvent.change(screen.getByLabelText("Quantity for Copper pipe"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add takeoff" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Material lists & prefabs" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(methods.importList).toHaveBeenCalledTimes(1));
    expect(methods.save).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 7 }),
    );
    expect(methods.importList).toHaveBeenCalledWith({
      id: estimateId,
      expectedRevision: 8,
      materialListId: "list-id",
    });
  });

  it("serializes drawing batches and retains a completed batch when stopped", async () => {
    const pending = deferred<EstimateRecord>();
    methods.analyze.mockReturnValueOnce(pending.promise);
    render(<EstimateWorkspace id={estimateId} />);
    fireEvent.click(screen.getByRole("button", { name: "Add takeoff" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Analyze selected sheets" }),
    );
    await waitFor(() => expect(methods.analyze).toHaveBeenCalledTimes(1));
    expect(methods.analyze.mock.calls[0]?.[0]).toEqual({
      id: estimateId,
      expectedRevision: 8,
      sheetIds: fixtureState.sheets.slice(0, 5).map((sheet) => sheet.id),
      includeRooms: false,
    });
    expect(screen.getByRole("button", { name: "Analyzing…" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Stop after current batch" }),
    );
    const saved = methods.save.mock.calls[0]?.[0] as {
      document: EstimateDocument;
    };
    const complete = record(
      {
        ...saved.document,
        lines: [
          ...saved.document.lines,
          newEstimateLine({
            description: "Measured duct length",
            quantity: 19,
            unit: "ft",
            source: {
              kind: "drawing-measurement",
              sheetId: fixtureState.sheets[0]!.id,
              markupId: "measure-1",
              revision: "3",
            },
          }),
        ],
      },
      9,
    );
    await act(async () => pending.resolve(complete));
    await waitFor(() =>
      expect(
        screen.getByText("Stopped — completed results retained"),
      ).toBeInTheDocument(),
    );
    expect(methods.analyze).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "5 / 6 sheets imported. Results are saved after each batch.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.getByLabelText("Quantity for Measured duct length"),
    ).toHaveValue(19);
    expect(screen.getByText(/Revision 9/)).toBeInTheDocument();
  });

  it("does not begin import after a failed save", async () => {
    methods.save.mockRejectedValueOnce(new Error("Connection failed"));
    render(<EstimateWorkspace id={estimateId} />);
    fireEvent.change(screen.getByLabelText("Quantity for Copper pipe"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add takeoff" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Material lists & prefabs" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(screen.getByText("Connection failed")).toBeInTheDocument(),
    );
    expect(methods.importList).not.toHaveBeenCalled();
  });

  it("requires explicit source review confirmation and preserves refused evidence", async () => {
    fixtureState.record!.document.lines[0]!.source = {
      kind: "drawing-measurement",
      sheetId: fixtureState.sheets[0]!.id,
      markupId: "measure-1",
    };
    fixtureState.record!.document.lines[0]!.reviewStatus = "unreviewed";
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    render(<EstimateWorkspace id={estimateId} />);
    fireEvent.click(screen.getByLabelText("Select Copper pipe"));
    fireEvent.click(screen.getByRole("button", { name: "Approve evidence" }));
    await waitFor(() =>
      expect(confirmAction).toHaveBeenCalledWith(
        expect.objectContaining({ confirmLabel: "Evidence reviewed" }),
      ),
    );
    expect(screen.getByLabelText("Review Copper pipe")).toHaveValue(
      "unreviewed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve evidence" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Review Copper pipe")).toHaveValue(
        "approved",
      ),
    );
  });

  it("keeps approved contents read-only and only offers valid next statuses", () => {
    fixtureState.record!.status = "approved";
    render(<EstimateWorkspace id={estimateId} />);
    expect(screen.getByLabelText("Quantity for Copper pipe")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
    const select = screen.getByLabelText("Next workflow status");
    expect(select).toHaveValue("sent");
    expect(
      Array.from(select.querySelectorAll("option")).map(
        (option) => option.value,
      ),
    ).toEqual(["sent", "archived"]);
  });

  it("keeps oversized values editable and clears the calculation error after correction", () => {
    const line = fixtureState.record!.document.lines[0]!;
    line.quantity = 100_000_000;
    line.multiplier = 10_000;
    line.materialUnitCost = 100_000_000;
    render(<EstimateWorkspace id={estimateId} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "supported monetary range",
    );
    expect(screen.getByLabelText("Quantity for Copper pipe")).toHaveValue(
      100_000_000,
    );
    expect(
      screen.getByRole("button", { name: "Customer proposal · PDF" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Quantity for Copper pipe"), {
      target: { value: "1" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quantity for Copper pipe")).toHaveValue(1);
  });

  it("pages editable rows while retaining document-wide totals and filters", () => {
    fixtureState.record!.document.lines = Array.from(
      { length: 64 },
      (_, index) =>
        newEstimateLine({
          id: `line-${index + 1}`,
          description: `Cost row ${index + 1}`,
          quantity: 1,
          materialUnitCost: 10,
          priceSource: "manual",
          reviewStatus: "approved",
        }),
    );
    render(<EstimateWorkspace id={estimateId} />);
    expect(
      screen.getByLabelText("Quantity for Cost row 1"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Quantity for Cost row 64"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "1–50 of 64 matching rows · Totals include the entire estimate",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next rows" }));
    expect(
      screen.getByLabelText("Quantity for Cost row 64"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Quantity for Cost row 1"),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter cost rows"), {
      target: { value: "Cost row 1" },
    });
    expect(
      screen.getByLabelText("Quantity for Cost row 1"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous rows" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next rows" })).toBeDisabled();
  });

  it("retains the first completed drawing batch if a later batch fails", async () => {
    methods.analyze
      .mockImplementationOnce(async () => {
        const saved = methods.save.mock.calls[0]?.[0] as {
          document: EstimateDocument;
        };
        return record(
          {
            ...saved.document,
            lines: [
              ...saved.document.lines,
              newEstimateLine({
                description: "Measured duct length",
                quantity: 19,
                unit: "ft",
              }),
            ],
          },
          9,
        );
      })
      .mockRejectedValueOnce(new Error("The final sheet could not be read"));
    render(<EstimateWorkspace id={estimateId} />);
    fireEvent.click(screen.getByRole("button", { name: "Add takeoff" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Analyze selected sheets" }),
    );
    await waitFor(() => expect(methods.analyze).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByText("The final sheet could not be read"),
      ).toBeInTheDocument(),
    );
    expect(methods.analyze.mock.calls[1]?.[0]).toEqual({
      id: estimateId,
      expectedRevision: 9,
      sheetIds: [fixtureState.sheets[5]!.id],
      includeRooms: false,
    });
    expect(
      screen.getByText(
        "5 / 6 sheets imported. Results are saved after each batch.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.getByLabelText("Quantity for Measured duct length"),
    ).toHaveValue(19);
  });

  it("tags an explicitly entered material price with the estimate currency", async () => {
    fixtureState.record!.document.lines[0]!.priceCurrency = "USD";
    fixtureState.record!.document.lines[0]!.priceSource = "imported";
    render(<EstimateWorkspace id={estimateId} />);
    fireEvent.change(
      screen.getByLabelText("Material unit price for Copper pipe"),
      { target: { value: "4.25" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(methods.save).toHaveBeenCalledTimes(1));
    const attempted = methods.save.mock.calls[0]?.[0] as {
      document: EstimateDocument;
    };
    expect(attempted.document.lines[0]).toMatchObject({
      materialUnitCost: 4.25,
      priceCurrency: "CAD",
      priceSource: "manual",
    });
  });

  it("keeps simulated price evidence until the estimator explicitly changes its source", async () => {
    fixtureState.pricing.rows[0]!.priceSource = "simulated";
    methods.savePricing.mockImplementation(
      async (input: typeof fixtureState.pricing) => ({ ...input, revision: 5 }),
    );
    render(<PricebookDialog open onOpenChange={vi.fn()} canEdit />);
    fireEvent.change(
      screen.getByLabelText("materialUnitCost for Copper pipe"),
      { target: { value: "7" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save pricebook" }));
    await waitFor(() => expect(methods.savePricing).toHaveBeenCalledTimes(1));
    const attempted = methods.savePricing.mock
      .calls[0]?.[0] as typeof fixtureState.pricing;
    expect(attempted.rows[0]?.priceSource).toBe("simulated");
    expect(
      screen.getByLabelText("Pricing evidence for Copper pipe"),
    ).toHaveValue("simulated");
  });
  it("does not convert unreviewed source evidence into approval when saving an assembly", async () => {
    const component = newEstimateLine({
      description: "Measured duct length",
      quantity: 19,
      unit: "ft",
      source: {
        kind: "drawing-measurement",
        evidence: "Saved scaled source line",
      },
      reviewStatus: "unreviewed",
    });
    methods.savePricing.mockImplementation(
      async (input: typeof fixtureState.pricing) => ({ ...input, revision: 5 }),
    );
    render(
      <PricebookDialog
        open
        onOpenChange={vi.fn()}
        canEdit
        assemblyLines={[component]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Assemblies (0)" }));
    fireEvent.change(screen.getByPlaceholderText("Assembly name"), {
      target: { value: "Duct section" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create assembly" }));
    fireEvent.click(screen.getByRole("button", { name: "Save pricebook" }));
    await waitFor(() => expect(methods.savePricing).toHaveBeenCalledTimes(1));
    const attempted = methods.savePricing.mock
      .calls[0]?.[0] as typeof fixtureState.pricing;
    expect(attempted.assemblies[0]?.lines[0]?.reviewStatus).toBe("unreviewed");
    expect(attempted.assemblies[0]?.lines[0]?.source.evidence).toContain(
      "Saved scaled source line",
    );
  });

  it("retains rate edits when a pricebook save conflicts", async () => {
    methods.savePricing.mockRejectedValueOnce(
      new Error("Pricebook revision changed"),
    );
    render(<PricebookDialog open onOpenChange={vi.fn()} canEdit />);
    fireEvent.change(
      screen.getByLabelText("materialUnitCost for Copper pipe"),
      { target: { value: "9.5" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save pricebook" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("edits are retained"),
    );
    expect(
      screen.getByLabelText("materialUnitCost for Copper pipe"),
    ).toHaveValue(9.5);
    expect(methods.savePricing).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 4,
        rows: [expect.objectContaining({ materialUnitCost: 9.5 })],
      }),
    );
  });
});
