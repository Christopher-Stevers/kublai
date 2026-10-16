import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogueScreen } from "./CatalogueScreen";
import type { CatalogueWorkbookOptions } from "~/lib/catalogue-xlsx-protocol";
const state = vi.hoisted(() => ({
  canEdit: true,
  online: true,
  read: vi.fn(),
  download: vi.fn(),
  fetch: vi.fn(),
  mutate: vi.fn(),
  invalidate: vi.fn(),
  notify: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      catalogue: {
        exportCatalogueRows: { fetch: state.fetch },
        searchParts: { invalidate: state.invalidate },
        getCatalogs: { invalidate: state.invalidate },
        getCategoryTree: { invalidate: state.invalidate },
        getMaterials: { invalidate: state.invalidate },
      },
    }),
    supplier: { list: { useQuery: () => ({ data: [] }) }, getById: { useQuery: () => ({ data: undefined }) } },
    user: {
      getMyRole: {
        useQuery: () => ({
          data: { permissions: { canEditParts: state.canEdit } },
        }),
      },
    },
    catalogue: {
      recentOrderWheelUsage:{useQuery:()=>({data:undefined})},
      importCatalogueRows: {
        useMutation: () => ({ mutateAsync: state.mutate }),
      },
    },
  },
}));
vi.mock("~/lib/catalogue-xlsx", () => ({
  readCatalogueImportWorkbook: state.read,
  downloadCatalogueRowsAsXlsx: state.download,
}));
vi.mock("~/components/ui/app-dialogs", () => ({
  notify: state.notify,
  confirmAction: state.confirm,
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => state.online,
}));
vi.mock("~/lib/server-connection-mode", () => ({
  TEMPORARILY_DISCONNECT_BROWSER_FROM_SERVER: false,
}));
vi.mock("~/components/materialLists/wizard/use-part-wizard", () => ({
  usePartWizard: () => ({
    catalogs: [],
    allUnits: [],
    wizardStage: "review",
    wizardSearchQuery: "",
  }),
}));
vi.mock("~/components/materialLists/WizardHeader", () => ({
  WizardHeader: () => null,
}));
vi.mock("~/components/app/DeferredFeatures", () => ({
  AddPartDialog: ({ managePrefabs, onOpenChange }: { managePrefabs?: boolean; onOpenChange: (open: boolean) => void }) => managePrefabs ? <div role="dialog" aria-label="Manage prefabs"><button onClick={() => onOpenChange(false)}>Close prefabs</button></div> : null,
  EditPartDialog: () => null,
  CreateCustomPartDialog: () => null,
  MaterialGroupsDialog: () => null,
  PhotoQueueDialog: () => null,
  PartStage: () => null,
}));
const rows = [
  {
    partId: "part-1",
    catalog: "Plumbing",
    displayName: "Pipe",
    description: "",
  },
];
const upload = () =>
  fireEvent.change(screen.getByLabelText("Import catalogue workbook"), {
    target: { files: [new File(["fixture"], "parts.xlsx")] },
  });
const openMore = () =>
  fireEvent.keyDown(screen.getByRole("button", { name: "More" }), {
    key: "Enter",
  });
beforeEach(() => {
  vi.clearAllMocks();
  state.canEdit = state.online = true;
  state.read.mockResolvedValue(rows);
  state.fetch.mockResolvedValue([]);
  state.download.mockResolvedValue(undefined);
  state.mutate.mockResolvedValue({ created: 1, updated: 0, skipped: 0 });
  state.confirm.mockResolvedValue(true);
});
afterEach(cleanup);
describe("catalogue workbook controls", () => {
  it("opens prefab management from More and closes it", () => {
    render(<CatalogueScreen />);
    openMore();
    fireEvent.click(screen.getByRole("menuitem", { name: "Prefabs" }));
    expect(screen.getByRole("dialog", { name: "Manage prefabs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close prefabs" }));
    expect(screen.queryByRole("dialog", { name: "Manage prefabs" })).not.toBeInTheDocument();
  });
  it("backs up before uploading unchanged rows and prevents competing operations", async () => {
    let release!: () => void;
    state.download.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<CatalogueScreen />);
    upload();
    await waitFor(() => expect(state.download).toHaveBeenCalled());
    expect(state.mutate).not.toHaveBeenCalled();
    openMore();
    expect(
      screen.getByRole("menuitem", { name: "Export XLSX" }),
    ).toHaveAttribute("aria-disabled", "true");
    await act(async () => {
      release();
    });
    await waitFor(() => expect(state.mutate).toHaveBeenCalledWith({ rows }));
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("Created 1"),
      "success",
    );
  });
  it("cancels preparation before any backup or server write, including late parse results", async () => {
    let release!: (value: typeof rows) => void;
    state.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<CatalogueScreen />);
    upload();
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel preparation" }),
    );
    expect(
      (state.read.mock.calls[0]![1] as CatalogueWorkbookOptions).signal
        ?.aborted,
    ).toBe(true);
    await act(async () => {
      release(rows);
    });
    expect(state.download).not.toHaveBeenCalled();
    expect(state.mutate).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });
  it("losing edit access prevents a prepared workbook from uploading", async () => {
    let release!: (value: typeof rows) => void;
    state.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = render(<CatalogueScreen />);
    upload();
    state.canEdit = false;
    view.rerender(<CatalogueScreen />);
    await act(async () => {
      release(rows);
    });
    expect(
      (state.read.mock.calls[0]![1] as CatalogueWorkbookOptions).signal
        ?.aborted,
    ).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });
  it("leaving the screen stops subsequent batches after an in-flight upload", async () => {
    state.read.mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => ({
        ...rows[0],
        partId: `part-${i}`,
      })),
    );
    let release!: (value: {
      created: number;
      updated: number;
      skipped: number;
    }) => void;
    state.mutate.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const view = render(<CatalogueScreen />);
    upload();
    await waitFor(() => expect(state.mutate).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: "Cancel preparation" }),
    ).not.toBeInTheDocument();
    view.unmount();
    await act(async () => {
      release({ created: 50, updated: 0, skipped: 0 });
    });
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });
  it("cancels exports and handles late server results without a download", async () => {
    let release!: (value: unknown[]) => void;
    state.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<CatalogueScreen />);
    openMore();
    fireEvent.click(screen.getByRole("menuitem", { name: "Export XLSX" }));
    const dialog = screen.getByRole("dialog", { name: "Export Catalogue" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Export XLSX" }),
    );
    await waitFor(() => expect(state.fetch).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    await act(async () => {
      release(rows);
    });
    expect(state.download).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });
});
