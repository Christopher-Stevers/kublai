import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultPipeSpec, type PipeSpec } from "~/lib/pipe-spec";
import {
  jobSystemRequirementsSchema,
  type SystemEvidence,
} from "~/lib/job-systems";
import { readSnapshotState } from "~/lib/snapshot-source";

const mock = vi.hoisted(() => ({
  save: vi.fn(),
  assess: vi.fn(),
  folder: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  push: vi.fn(),
  specs: {} as Record<string, unknown>,
  status: {} as Record<string, unknown>,
  search: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("~/components/ui/app-dialogs", () => ({
  confirmAction: vi.fn(async () => true),
}));
const uuid = (digit: string) => `00000000-0000-4000-8000-00000000000${digit}`;
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ pipeSpecs: { list: { invalidate: mock.invalidate } } }),
    pipeSpecs: {
      list: {
        useQuery: () => ({
          data: mock.specs,
          isLoading: false,
          refetch: mock.refetch,
        }),
      },
      assessment: {
        useQuery: () => ({ data: mock.status, refetch: mock.refetch }),
      },
      save: {
        useMutation: () => ({ mutateAsync: mock.save, isPending: false }),
      },
      assess: {
        useMutation: () => ({ mutateAsync: mock.assess, isPending: false }),
      },
      ensureSpecifications: {
        useMutation: () => ({ mutateAsync: mock.folder, isPending: false }),
      },
    },
    catalogue: {
      getMaterials: {
        useQuery: () => ({
          data: [
            { id: "00000000-0000-4000-8000-000000000004", name: "Copper" },
            { id: "00000000-0000-4000-8000-000000000005", name: "Steel" },
          ],
        }),
      },
      getCatalogs: {
        useQuery: () => ({
          data: [
            { id: "00000000-0000-4000-8000-000000000006", name: "Plumbing" },
          ],
        }),
      },
      getCategories: {
        useQuery: () => ({
          data: [
            {
              categoryId: "00000000-0000-4000-8000-000000000007",
              name: "Pipe",
            },
          ],
        }),
      },
      searchParts: {
        useQuery: (args: unknown) => {
          mock.search(args);
          return {
            data: [{ id: "part", displayName: '2" Type L copper pipe' }],
            isLoading: false,
          };
        },
      },
    },
  },
}));
import { JobSystemsView } from "./JobSystemsView";
import { JobSystemsEditor } from "./JobSystemsEditor";
import { systemEvidenceHref } from "./JobSystemEvidence";

const evidence: SystemEvidence = {
  id: "section-23",
  documentId: uuid("2"),
  versionId: uuid("3"),
  documentTitle: "Mechanical specifications",
  page: 17,
  section: "23 21 13",
  quote: "Heating pipe 2 inches and smaller may be copper or steel.",
};
function spec(): PipeSpec {
  return {
    ...defaultPipeSpec(),
    requirements: jobSystemRequirementsSchema.parse({
      systemName: "Heating water",
      applicabilityEvidence: [evidence],
      rules: [
        {
          id: "heating-small",
          label: "Small heating pipe",
          group: "pipe",
          sizeRange: { unit: "in", max: 2 },
          alternatives: [
            { id: "copper", label: "Type L copper", materialId: uuid("4") },
            { id: "steel", label: "Steel", materialId: uuid("5") },
          ],
          evidence: [evidence],
        },
      ],
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.specs = {
    job: [{ system: "HW", spec: spec(), revision: 2 }],
    company: [],
    canEditJob: true,
  };
  mock.status = {
    assessment: null,
    stale: false,
    providerConfigured: true,
    canAssess: true,
    folderId: uuid("8"),
    documents: [
      {
        id: uuid("2"),
        name: "Mechanical specifications",
        versionId: uuid("3"),
        mimeType: "application/pdf",
      },
    ],
  };
  mock.save.mockResolvedValue({ revision: 3 });
  mock.assess.mockResolvedValue({ runId: "run-1" });
  mock.folder.mockResolvedValue({ folderId: uuid("8") });
  mock.refetch.mockResolvedValue({});
});
afterEach(cleanup);

it("assesses only on request and refreshes systems when a run completes", async () => {
  const view = render(<JobSystemsView jobId={uuid("1")} />);
  expect(mock.assess).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Assess Sources" }));
  await waitFor(() =>
    expect(mock.assess).toHaveBeenCalledWith({
      jobId: uuid("1"),
      selection: { documentIds: [uuid("2")], drawingSetIds: [] },
    }),
  );
  mock.status = {
    ...mock.status,
    assessment: {
      runId: "run-1",
      status: "processing",
      stage: "Reading sources",
      warnings: [],
    },
  };
  view.rerender(<JobSystemsView jobId={uuid("1")} />);
  expect(screen.getByText(/Reading sources/)).toBeInTheDocument();
  mock.status = {
    ...mock.status,
    assessment: { runId: "run-1", status: "ready", warnings: [] },
  };
  view.rerender(<JobSystemsView jobId={uuid("1")} />);
  await waitFor(() =>
    expect(mock.invalidate).toHaveBeenCalledWith({ jobId: uuid("1") }),
  );
  expect(
    screen.getByRole("button", { name: "Reassess Sources" }),
  ).toBeEnabled();
});

it("opens the real Specifications folder without duplicating it", async () => {
  render(<JobSystemsView jobId={uuid("1")} />);
  fireEvent.click(screen.getByRole("button", { name: "Specifications" }));
  await waitFor(() =>
    expect(mock.push).toHaveBeenCalledWith(
      `/dashboard/jobs/${uuid("1")}/documents?folder=${uuid("8")}`,
    ),
  );
  expect(mock.folder).not.toHaveBeenCalled();
});

it("saves explicit alternative choice and size boundary review as a retained override", async () => {
  render(
    <JobSystemsEditor
      jobId={uuid("1")}
      system="HW"
      initial={spec()}
      revision={2}
      canEdit
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Small heating pipe"));
  fireEvent.change(
    screen.getByLabelText("Material option to use for this job"),
    { target: { value: "steel" } },
  );
  fireEvent.change(
    screen.getByLabelText("Maximum nominal size", { exact: false }),
    { target: { value: "2.5" } },
  );
  fireEvent.click(screen.getByLabelText("I reviewed this requirement"));
  fireEvent.click(screen.getByRole("button", { name: "Save system" }));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  const saved = mock.save.mock.calls[0]![0] as {
    revision: number;
    spec: PipeSpec;
  };
  expect(saved.revision).toBe(2);
  expect(saved.spec.requirements!.rules[0]).toMatchObject({
    selectedAlternativeId: "steel",
    manualOverride: true,
    reviewStatus: "approved",
    sizeRange: { max: 2.5, maxInclusive: true },
  });
  expect(saved.spec.requirements!.rules[0]!.evidence).toEqual([evidence]);
});

it("keeps a draft when server assessment changes and guards its old revision", () => {
  const initial = spec();
  const view = render(
    <JobSystemsEditor
      jobId={uuid("1")}
      system="HW"
      initial={initial}
      revision={2}
      canEdit
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("System name"), {
    target: { value: "My reviewed heating" },
  });
  view.rerender(
    <JobSystemsEditor
      jobId={uuid("1")}
      system="HW"
      initial={{
        ...initial,
        requirements: {
          ...initial.requirements!,
          systemName: "New assessment name",
        },
      }}
      revision={3}
      canEdit
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByDisplayValue("My reviewed heating")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "changed while you were editing",
  );
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByDisplayValue("New assessment name")).toBeInTheDocument();
});

it("remembers removed requirements so reassessment cannot resurrect them", async () => {
  render(
    <JobSystemsEditor
      jobId={uuid("1")}
      system="HW"
      initial={spec()}
      revision={2}
      canEdit
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("Small heating pipe"));
  fireEvent.click(screen.getByRole("button", { name: "Remove requirement" }));
  fireEvent.click(screen.getByRole("button", { name: "Save system" }));
  await waitFor(() => expect(mock.save).toHaveBeenCalled());
  const saved = mock.save.mock.calls[0]![0] as { spec: PipeSpec };
  expect(saved.spec.requirements!.rules).toHaveLength(0);
  expect(saved.spec.requirements!.suppressedRuleIds).toEqual(["heating-small"]);
});

it("opens the cited document version at its exact one-based page", () => {
  const href = new URL(
    systemEvidenceHref(uuid("1"), evidence),
    "https://example.test",
  );
  expect(href.searchParams.get("document")).toBe(uuid("2"));
  expect(readSnapshotState(href.hash)).toMatchObject({
    document: { versionId: uuid("3") },
    pdf: { page: 17 },
  });
});

it("lets the user select documents outside Specifications and drawing sets", async () => {
  mock.status = {
    ...mock.status,
    documents: [
      { id: uuid("2"), name: "Specifications", inSpecifications: true },
      { id: uuid("3"), name: "Piping schedule", inSpecifications: false },
    ],
    drawingSets: [{ id: uuid("4"), name: "Mechanical", sheetCount: 41 }],
  };
  render(<JobSystemsView jobId={uuid("1")} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByRole("button", { name: "Assess Sources" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Include document Piping schedule"));
  fireEvent.click(screen.getByLabelText("Include drawing set Mechanical"));
  fireEvent.click(screen.getByRole("button", { name: "Assess Sources" }));
  await waitFor(() =>
    expect(mock.assess).toHaveBeenCalledWith({
      jobId: uuid("1"),
      selection: { documentIds: [uuid("3")], drawingSetIds: [uuid("4")] },
    }),
  );
});
it("reuses the last assessment source selection", () => {
  mock.status = {
    ...mock.status,
    drawingSets: [{ id: uuid("4"), name: "Mechanical", sheetCount: 41 }],
    assessment: {
      runId: "prior",
      status: "ready",
      warnings: [],
      selection: { documentIds: [], drawingSetIds: [uuid("4")] },
    },
  };
  render(<JobSystemsView jobId={uuid("1")} />);
  expect(screen.getByLabelText("Include drawing set Mechanical")).toBeChecked();
  expect(
    screen.getByLabelText("Include document Mechanical specifications"),
  ).not.toBeChecked();
});
it("opens drawing evidence at the cited sheet and immutable revision", () => {
  const href = systemEvidenceHref(uuid("1"), {
    ...evidence,
    drawing: { setId: uuid("4"), sheetId: uuid("5"), sourceSheetId: uuid("6") },
  });
  const url = new URL(href, "https://app.test");
  expect(url.pathname).toBe(`/dashboard/jobs/${uuid("1")}/drawings`);
  expect(readSnapshotState(url.hash)?.drawing).toMatchObject({
    sheetId: uuid("5"),
    sourceSheetId: uuid("6"),
    setId: uuid("4"),
  });
});
