import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BimWorkspace } from "~/lib/bim/types";
import { setAppPageActive } from "~/lib/app-page-activity";

const fixture = vi.hoisted(() => ({
  online: true,
  workspace: vi.fn<(input: { jobId: string }) => Promise<BimWorkspace>>(),
  scene: vi.fn(),
  mutation: vi.fn(),
  progress: "",
}));
vi.mock("~/hooks/use-online-status", () => ({
  useOnlineStatus: () => fixture.online,
  getBrowserOnlineStatus: () => fixture.online,
}));
// Keep the actual workspace/register/selection and read UI. WebGL/IFC work and
// adjacent editors are outside this read-lifecycle proof; no model files load.
vi.mock("./use-model-scene", () => ({
  useModelScene: (...args: unknown[]) => {
    fixture.scene(...args);
    return {
      scene: null, elements: [], progress: fixture.progress,
      properties: [], measures: [], ready: false,
    };
  },
}));
vi.mock("./ModelDialogs", () => ({
  IssueDialog: () => null, UploadModelDialog: () => null, inputClass: "",
}));
vi.mock("./NewCadDialog", () => ({ NewCadDialog: () => null }));
vi.mock("./ModelDesignEditor", () => ({ ModelDesignEditor: () => null }));
vi.mock("~/trpc/react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const mutation = { useMutation: () => ({ mutate: fixture.mutation, isPending: false }) };
  return {
    api: {
      models: {
        workspace: {
          _def: () => ({ path: ["models", "workspace"] }),
          useQuery: (input: { jobId: string }, options: object) => useQuery({
            ...options,
            queryKey: [["models", "workspace"], { input, type: "query" }],
            queryFn: () => fixture.workspace(input),
          }),
        },
        publication: mutation, convert: mutation, saveView: mutation,
        removeView: mutation, remove: mutation,
      },
    },
  };
});
import { JobModelsView } from "./JobModelsView";

const JOB_A = "10000000-0000-4000-8000-000000000001";
const JOB_B = "10000000-0000-4000-8000-000000000002";
const MODEL_A = "20000000-0000-4000-8000-000000000001";
const MODEL_B = "20000000-0000-4000-8000-000000000002";
const key = (jobId: string) => [["models", "workspace"], { input: { jobId }, type: "query" }];
function workspace(jobId = JOB_A, name = "Architecture"): BimWorkspace {
  const modelId = jobId === JOB_A ? MODEL_A : MODEL_B;
  return {
    job: { id: jobId, name: jobId === JOB_A ? "Job A" : "Job B" },
    userId: "synthetic-user", canUpload: false, canDelete: false,
    canConfigureAutodesk: false, conversionAvailable: true,
    views: [], issues: [], members: [],
    models: [{
      id: modelId, seriesId: modelId, version: 2, name,
      discipline: "architecture", filename: "synthetic.ifc", format: "ifc",
      size: 100, status: "ready", publication: "coordination",
      conversionMessage: null, uploadedBy: "Synthetic user",
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: {
    queries: { staleTime: 300_000, retry: false, gcTime: Infinity },
  } });
  clients.push(client);
  return {
    client,
    wrap: (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  };
}
beforeEach(() => {
  fixture.online = true;
  fixture.progress = "";
  fixture.workspace.mockReset().mockResolvedValue(workspace());
  fixture.scene.mockReset(); fixture.mutation.mockReset();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  setAppPageActive(true);
  vi.unstubAllGlobals();
});

it("paints fresh cached metadata while refreshing and keeps the selected model/canvas on authoritative success", async () => {
  const { client, wrap } = setup();
  const response = deferred<BimWorkspace>();
  client.setQueryData(key(JOB_A), workspace());
  fixture.workspace.mockReturnValue(response.promise);
  render(wrap(<JobModelsView jobId={JOB_A} />));
  const canvas = screen.getByTestId("model-canvas");
  const selected = screen.getByRole("checkbox", { name: "Open Architecture version 2" });
  expect(selected).toBeVisible();
  expect(screen.queryByLabelText("Opening model workspace")).not.toBeInTheDocument();
  fireEvent.click(selected);
  await waitFor(() => expect(fixture.workspace).toHaveBeenCalledExactlyOnceWith({ jobId: JOB_A }));
  await act(async () => response.resolve(workspace(JOB_A, "Updated architecture")));
  const updated = await screen.findByRole("checkbox", { name: "Open Updated architecture version 2" });
  expect(updated).toBeChecked();
  expect(screen.getByTestId("model-canvas")).toBe(canvas);
  expect(fixture.scene.mock.lastCall?.[2]).toEqual([MODEL_A]);
  expect(fixture.mutation).not.toHaveBeenCalled();
});

it("keeps selection, processing state and existing permission controls on a transient refresh error", async () => {
  const { client, wrap } = setup();
  const cached = workspace();
  cached.models.push({ ...cached.models[0]!, id: MODEL_B, seriesId: MODEL_B, name: "Processing model", status: "processing" });
  client.setQueryData(key(JOB_A), cached);
  fixture.progress = "Opening model…";
  const response = deferred<BimWorkspace>();
  fixture.workspace.mockReturnValue(response.promise);
  render(wrap(<JobModelsView jobId={JOB_A} />));
  const selected = screen.getByRole("checkbox", { name: "Open Architecture version 2" });
  fireEvent.click(selected);
  const canvas = screen.getByTestId("model-canvas");
  await waitFor(() => expect(fixture.workspace).toHaveBeenCalledOnce());
  await act(async () => response.reject(new Error("Connection interrupted")));
  await screen.findByText(/Showing saved data/);
  expect(selected).toBeChecked();
  expect(screen.getByTestId("model-canvas")).toBe(canvas);
  expect(screen.getByRole("checkbox", { name: "Open Processing model version 2" })).toBeDisabled();
  expect(screen.getByText("Opening model…")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Add a model" })).not.toBeInTheDocument();
  expect(fixture.mutation).not.toHaveBeenCalled();
});

for (const code of ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"]) {
  it(`hides cached model data and selected viewer after terminal ${code}`, async () => {
    const { client, wrap } = setup();
    const response = deferred<BimWorkspace>();
    client.setQueryData(key(JOB_A), workspace());
    fixture.workspace.mockReturnValue(response.promise);
    render(wrap(<JobModelsView jobId={JOB_A} />));
    fireEvent.click(screen.getByRole("checkbox", { name: "Open Architecture version 2" }));
    await waitFor(() => expect(fixture.workspace).toHaveBeenCalledOnce());
    await act(async () => response.reject(Object.assign(new Error("Model access unavailable"), { data: { code } })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Model access unavailable");
    expect(screen.queryByTestId("model-canvas")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing saved data/)).not.toBeInTheDocument();
    expect(fixture.mutation).not.toHaveBeenCalled();
  });
}

it("distinguishes an uncached offline workspace from an acknowledged empty cached register", () => {
  fixture.online = false;
  const { client, wrap } = setup();
  const view = render(wrap(<JobModelsView jobId={JOB_A} />));
  expect(screen.getByText("Models are unavailable offline. Connect to load this workspace.")).toBeVisible();
  expect(screen.queryByText("See the whole job in 3D")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Opening model workspace")).not.toBeInTheDocument();
  expect(fixture.workspace).not.toHaveBeenCalled();
  view.unmount();
  client.setQueryData(key(JOB_A), { ...workspace(), models: [] });
  render(wrap(<JobModelsView jobId={JOB_A} />));
  expect(screen.getByText("See the whole job in 3D")).toBeVisible();
  expect(screen.queryByText(/Models are unavailable offline/)).not.toBeInTheDocument();
  expect(fixture.workspace).not.toHaveBeenCalled();
});

it("keeps exact job keys isolated and never paints an old job's late response in the new job", async () => {
  const { client, wrap } = setup();
  const old = deferred<BimWorkspace>(), current = deferred<BimWorkspace>();
  client.setQueryData(key(JOB_A), workspace());
  client.setQueryData(key(JOB_B), workspace(JOB_B, "Structure"));
  fixture.workspace.mockImplementation(({ jobId }) => jobId === JOB_A ? old.promise : current.promise);
  const view = render(wrap(<JobModelsView jobId={JOB_A} />));
  fireEvent.click(screen.getByRole("checkbox", { name: "Open Architecture version 2" }));
  await waitFor(() => expect(fixture.workspace).toHaveBeenCalledWith({ jobId: JOB_A }));
  view.rerender(wrap(<JobModelsView jobId={JOB_B} />));
  const b = screen.getByRole("checkbox", { name: "Open Structure version 2" });
  expect(b).not.toBeChecked();
  expect(screen.queryByRole("checkbox", { name: /Architecture/ })).not.toBeInTheDocument();
  await waitFor(() => expect(fixture.workspace).toHaveBeenCalledWith({ jobId: JOB_B }));
  await act(async () => old.resolve(workspace(JOB_A, "Late architecture")));
  expect(screen.queryByText("Late architecture")).not.toBeInTheDocument();
  expect(b).toBeInTheDocument();
  await act(async () => current.resolve(workspace(JOB_B, "Current structure")));
  expect(await screen.findByRole("checkbox", { name: "Open Current structure version 2" })).not.toBeChecked();
});

it("pauses background reads and refreshes fresh cached metadata on internal-page resume without losing selection", async () => {
  const { client, wrap } = setup();
  client.setQueryData(key(JOB_A), workspace());
  const response = deferred<BimWorkspace>();
  setAppPageActive(false);
  fixture.workspace.mockReturnValue(response.promise);
  render(wrap(<JobModelsView jobId={JOB_A} />));
  const selected = screen.getByRole("checkbox", { name: "Open Architecture version 2" });
  fireEvent.click(selected);
  expect(fixture.workspace).not.toHaveBeenCalled();
  const canvas = screen.getByTestId("model-canvas");
  await act(async () => setAppPageActive(true));
  await waitFor(() => expect(fixture.workspace).toHaveBeenCalledExactlyOnceWith({ jobId: JOB_A }));
  expect(screen.getByTestId("model-canvas")).toBe(canvas);
  expect(selected).toBeChecked();
  await act(async () => response.resolve(workspace()));
  expect(screen.getByTestId("model-canvas")).toBe(canvas);
  expect(selected).toBeChecked();
});
