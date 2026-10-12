import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BimWorkspace } from "~/lib/bim/types";
import { AppDialogHost } from "~/components/ui/app-dialogs";
import { ModelWorkspace } from "./JobModelsView";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(async (_input: { jobId: string; id: string }) => ({
    ok: true,
  })),
  scene: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./use-model-scene", () => ({
  useModelScene: (...args: unknown[]) => {
    mocks.scene(...args);
    return {
      scene: null,
      elements: [],
      progress: null,
      properties: [],
      measures: [],
      ready: false,
    };
  },
}));
vi.mock("./ModelDialogs", () => ({
  IssueDialog: () => null,
  UploadModelDialog: () => null,
  inputClass: "",
}));
vi.mock("~/components/ui/app-dialogs", async (original) => ({
  ...(await original<object>()),
  notify: vi.fn(),
}));
vi.mock("~/trpc/react", () => {
  const noop = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  return {
    api: {
      models: {
        publication: noop,
        convert: noop,
        saveView: noop,
        removeView: noop,
        remove: {
          useMutation: (options: {
            onSuccess: (
              result: { ok: boolean },
              input: { jobId: string; id: string },
            ) => void;
            onError: (error: Error) => void;
          }) => ({
            isPending: false,
            mutate: (input: { jobId: string; id: string }) => {
              void mocks
                .remove(input)
                .then(
                  (result) => options.onSuccess(result, input),
                  options.onError,
                );
            },
          }),
        },
      },
    },
  };
});
const modelId = "10000000-0000-4000-8000-000000000001";
function workspace(canDelete = true): BimWorkspace {
  return {
    job: { id: "10000000-0000-4000-8000-000000000002", name: "Test job" },
    userId: "owner",
    canUpload: false,
    canDelete,
    canConfigureAutodesk: false,
    conversionAvailable: true,
    views: [],
    issues: [],
    members: [],
    models: [
      {
        id: modelId,
        seriesId: modelId,
        version: 2,
        name: "Architecture",
        discipline: "architecture",
        filename: "Architecture.ifc",
        format: "ifc",
        size: 100,
        status: "ready",
        publication: "coordination",
        conversionMessage: null,
        uploadedBy: "Owner",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}
function mount(w = workspace()) {
  return render(
    <>
      <ModelWorkspace workspace={w} refresh={mocks.refresh} />
      <AppDialogHost />
    </>,
  );
}
async function options() {
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Actions for Architecture version 2" }),
    { key: "Enter" },
  );
  return screen.findByRole("menu");
}
async function requestDelete() {
  await options();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete model" }));
  return screen.findByRole("dialog", { name: "Delete Architecture (v2)?" });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue({ ok: true });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("model options deletion", () => {
  it("keeps Delete hidden without delete permission", async () => {
    mount(workspace(false));
    const menu = await options();
    expect(
      within(menu).queryByRole("menuitem", { name: "Delete model" }),
    ).not.toBeInTheDocument();
  });
  it("requires confirmation and unloads the selected model on success", async () => {
    const w = workspace();
    mount(w);
    const open = screen.getByRole("checkbox", {
      name: "Open Architecture version 2",
    });
    fireEvent.click(open);
    let dialog = await requestDelete();
    expect(
      within(dialog).getByText(/Other revisions and issue history are kept/),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(open).toBeChecked();
    dialog = await requestDelete();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete model" }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({
      jobId: w.job.id,
      id: modelId,
    });
    expect(open).not.toBeChecked();
    expect(mocks.scene.mock.lastCall?.[2]).toEqual([]);
  });
  it("leaves the model open and displays an error when deletion fails", async () => {
    mocks.remove.mockRejectedValueOnce(
      new Error("Delete permission was removed."),
    );
    mount();
    const open = screen.getByRole("checkbox", {
      name: "Open Architecture version 2",
    });
    fireEvent.click(open);
    const dialog = await requestDelete();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete model" }),
    );
    expect(
      await screen.findByText("Delete permission was removed."),
    ).toBeInTheDocument();
    expect(open).toBeChecked();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("unloads models removed by another user after workspace refresh", () => {
    const w = workspace();
    const { rerender } = mount(w);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Open Architecture version 2" }),
    );
    expect(mocks.scene.mock.lastCall?.[2]).toEqual([modelId]);
    rerender(
      <>
        <ModelWorkspace
          workspace={{ ...w, models: [] }}
          refresh={mocks.refresh}
        />
        <AppDialogHost />
      </>,
    );
    expect(mocks.scene.mock.lastCall?.[2]).toEqual([]);
    expect(
      screen.queryByRole("button", {
        name: "Actions for Architecture version 2",
      }),
    ).not.toBeInTheDocument();
  });
});
