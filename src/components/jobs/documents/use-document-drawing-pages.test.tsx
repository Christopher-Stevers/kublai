import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Activity } from "react";
import { IDBFactory } from "fake-indexeddb";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import {
  DrawingOfflineStore,
  setDrawingOfflineAccount,
} from "~/lib/drawing-offline";
import type { RouterOutputs } from "~/trpc/react";
import { DrawingAccountProvider } from "../DrawingAccountProvider";
import { DocumentDrawingWorkspace } from "./DocumentDrawingWorkspace";
import { validDocumentPages } from "./use-document-drawing-pages";
const state = vi.hoisted(() => ({
  open: vi.fn<
    (input: { jobId: string; versionId: string }) => Promise<Pages>
  >(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: {
      openDocument: {
        useMutation: (options: object) =>
          useMutation<Pages, Error, { jobId: string; versionId: string }>({
            mutationFn: state.open,
            ...options,
          }),
      },
    },
  },
}));
vi.mock("~/lib/pdf-client", () => ({ clearPdfDocuments: vi.fn() }));
vi.mock("~/lib/drawing-text", () => ({ clearDrawingTextIndexes: vi.fn() }));
vi.mock("../DrawingWorkspace", () => ({
  DrawingWorkspace: ({ sheet }: { sheet: { id: string; name: string } }) => (
    <p>
      Rendered {sheet.name} {sheet.id}
    </p>
  ),
}));
vi.mock("../DrawingPageMode", () => ({
  useDrawingPageMode: () => ({ scroll: false }),
}));
vi.mock("../useDrawingFullscreen", () => ({
  useDrawingFullscreen: () => ({
    fullscreen: false,
    enter: vi.fn(),
    exit: vi.fn(),
  }),
}));
vi.mock("~/components/chat/SnapshotSourceContext", () => ({
  useSnapshotSource: vi.fn(),
}));
type Pages = RouterOutputs["drawingsWorkspace"]["openDocument"];
const org = "11111111-1111-4111-8111-111111111111",
  job = "22222222-2222-4222-8222-222222222222",
  version = "33333333-3333-4333-8333-333333333333",
  otherVersion = "44444444-4444-4444-8444-444444444444",
  page = "55555555-5555-4555-8555-555555555555",
  set = "66666666-6666-4666-8666-666666666666";
function pages(versionId = version, name = "Saved page"): Pages {
  return [
    {
      id: page,
      setId: set,
      jobId: job,
      organizationId: org,
      documentVersionId: versionId,
      name,
      imageUrl: `/api/job-documents/pages/${versionId}/1?jobId=${job}`,
      width: 600,
      height: 800,
      sortOrder: 1,
      sourceFilename: "plan.pdf",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  ] as Pages;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const clients: QueryClient[] = [];
const account = `${org}:actor`;
async function seed(value: unknown = pages()) {
  const store = new DrawingOfflineStore(account);
  await store.saveSnapshot(`document-sheets:${version}`, value);
  store.dispose();
}
function tree(client: QueryClient, versionId = version, userId = "actor", hidden = false) {
  return (
    <QueryClientProvider client={client}>
      <DrawingAccountProvider organizationId={org} userId={userId}>
        <Activity mode={hidden ? "hidden" : "visible"}><DocumentDrawingWorkspace jobId={job} versionId={versionId} /></Activity>
      </DrawingAccountProvider>
    </QueryClientProvider>
  );
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return { client, ...render(tree(client)) };
}
beforeAll(() => vi.stubGlobal("indexedDB", new IDBFactory()));
beforeEach(async () => {
  vi.clearAllMocks();
  state.open.mockReset();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await setDrawingOfflineAccount(account);
  const store = new DrawingOfflineStore(account);
  await store.clear();
  store.dispose();
});
afterEach(async () => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  await setDrawingOfflineAccount(null);
  vi.restoreAllMocks();
});
afterAll(() => vi.unstubAllGlobals());
it("paints real saved page identities online before materialization completes, then replaces with accepted rows", async () => {
  await seed();
  const request = deferred<Pages>();
  state.open.mockReturnValue(request.promise);
  mount();
  await screen.findByText(`Rendered Saved page ${page}`);
  expect(state.open).toHaveBeenCalledTimes(1);
  await act(async () => {
    request.resolve(pages(version, "Authoritative page"));
  });
  await screen.findByText(`Rendered Authoritative page ${page}`);
});
it("keeps saved paint on transient failure, with notice and no replay", async () => {
  await seed();
  const request = deferred<Pages>();
  state.open.mockReturnValue(request.promise);
  mount();
  await screen.findByText(`Rendered Saved page ${page}`);
  await act(async () => {
    request.reject(new Error("Network failed"));
  });
  await screen.findByText(/Saved pages shown. Could not refresh/);
  expect(screen.getByText(`Rendered Saved page ${page}`)).toBeTruthy();
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect(state.open).toHaveBeenCalledTimes(1);
});
it("locks the real account provider on materialization denial before a late saved read can paint", async () => {
  await seed();
  const network = deferred<Pages>(),
    disk = deferred<Pages | null>();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Deliberately preserve the method, then invoke it with the intercepted store via .call below.
  const actual = DrawingOfflineStore.prototype.readSnapshot;
  let captured = false;
  vi.spyOn(DrawingOfflineStore.prototype, "readSnapshot").mockImplementation(
    async function <T>(this: DrawingOfflineStore, key: string) {
      const value = (await actual.call(this, key)) as T | null;
      if (key === `document-sheets:${version}`) {
        captured = true;
        return (await disk.promise) as T | null;
      }
      return value;
    },
  );
  state.open.mockReturnValue(network.promise);
  mount();
  await waitFor(() => expect(captured).toBe(true));
  await waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
  await act(async () => {
    network.reject(
      Object.assign(new Error("Forbidden"), { data: { code: "FORBIDDEN" } }),
    );
  });
  await screen.findByRole("button", { name: "Reload session" });
  await act(async () => {
    disk.resolve(pages());
    window.dispatchEvent(new Event("online"));
  });
  expect(screen.queryByText(`Rendered Saved page ${page}`)).toBeNull();
  expect(state.open).toHaveBeenCalledTimes(1);
});
it("rejects saved rows from another job/version/organization and keeps real opening pending", async () => {
  await seed(pages(otherVersion));
  const request = deferred<Pages>();
  state.open.mockReturnValue(request.promise);
  mount();
  await screen.findByText("Opening drawing workspace…");
  expect(screen.queryByText(/Rendered/)).toBeNull();
  for (const change of [
    { jobId: "other" },
    { organizationId: "other" },
    { documentVersionId: otherVersion },
    { id: "invented" },
  ])
    expect(
      validDocumentPages([{ ...pages()[0], ...change }], job, version, org),
    ).toBe(false);
});
it("fences late old-version success when props are reused and does not save under the new key", async () => {
  const first = deferred<Pages>(),
    second = deferred<Pages>();
  state.open
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { client, rerender } = mount();
  await waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
  rerender(tree(client, otherVersion));
  await waitFor(() => expect(state.open).toHaveBeenCalledTimes(2));
  await act(async () => {
    first.resolve(pages());
  });
  expect(screen.queryByText(/Rendered/)).toBeNull();
  await act(async () => {
    second.resolve(pages(otherVersion, "New version page"));
  });
  await screen.findByText(`Rendered New version page ${page}`);
  const store = new DrawingOfflineStore(account);
  expect(await store.readSnapshot(`document-sheets:${version}`)).toBeNull();
  store.dispose();
});
it("opens saved pages offline, then refreshes the selected read on a real reconnect", async () => {
  await seed(); const request = deferred<Pages>(); state.open.mockReturnValue(request.promise);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); mount();
  await screen.findByText(`Rendered Saved page ${page}`); expect(state.open).not.toHaveBeenCalled();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(async () => {window.dispatchEvent(new Event("online"));});
  await waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
  expect(screen.getByText(`Rendered Saved page ${page}`)).toBeTruthy();
  await act(async () => {request.resolve(pages(version, "Reconnected page"));});
  await screen.findByText(`Rendered Reconnected page ${page}`);
});

it("old-account success cannot paint or persist into the new validated account", async () => {
  const first = deferred<Pages>(),
    second = deferred<Pages>();
  state.open
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { client, rerender } = mount();
  await waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
  rerender(tree(client, version, "other-actor"));
  await waitFor(() => expect(state.open).toHaveBeenCalledTimes(2));
  await act(async () => {
    first.resolve(pages());
  });
  expect(screen.queryByText(/Rendered/)).toBeNull();
});

it("cache miss keeps materialization pending and retries only after an explicit click", async () => {
  state.open.mockRejectedValueOnce(new Error("Network failed"));
  mount();
  await screen.findByRole("alert");
  expect(screen.queryByText(/Rendered/)).toBeNull();
  state.open.mockResolvedValueOnce(pages());
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText(`Rendered Saved page ${page}`);
  expect(state.open).toHaveBeenCalledTimes(2);
});
it("does not read private saved pages before validated account context is ready", async () => {
  await seed();
  const client = new QueryClient();
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <DocumentDrawingWorkspace jobId={job} versionId={version} />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Opening your workspace…")).toBeTruthy();
  expect(state.open).not.toHaveBeenCalled();
  expect(screen.queryByText(/Rendered/)).toBeNull();
});
it("terminal denial removes already painted saved pages and remains locked on reconnect", async () => {
  await seed();
  const network = deferred<Pages>();
  state.open.mockReturnValue(network.promise);
  mount();
  await screen.findByText(`Rendered Saved page ${page}`);
  await act(async () => {
    network.reject(
      Object.assign(new Error("Document removed"), {
        data: { code: "NOT_FOUND" },
      }),
    );
  });
  await screen.findByRole("button", { name: "Reload session" });
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect(screen.queryByText(/Rendered/)).toBeNull();
  expect(state.open).toHaveBeenCalledTimes(1);
});
it("rejects wrong-version live output rather than persisting it as accepted pages", async () => {
  state.open.mockResolvedValueOnce(pages(otherVersion));
  mount();
  await screen.findByRole("alert");
  expect(screen.queryByText(/Rendered/)).toBeNull();
  const store = new DrawingOfflineStore(account);
  expect(await store.readSnapshot(`document-sheets:${version}`)).toBeNull();
  store.dispose();
});

it("real provider Activity pause fences pending response persistence and resumes with a new read", async () => {
  const first = deferred<Pages>(), second = deferred<Pages>(); state.open.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const {client, rerender} = mount(); await waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
  rerender(tree(client, version, "actor", true));
  await act(async () => {first.resolve(pages());});
  const store = new DrawingOfflineStore(account); expect(await store.readSnapshot(`document-sheets:${version}`)).toBeNull(); store.dispose();
  rerender(tree(client)); await waitFor(() => expect(state.open).toHaveBeenCalledTimes(2)); expect(screen.queryByText(/Rendered/)).toBeNull();
  await act(async () => {second.resolve(pages(version, "Resumed page"));});
  await screen.findByText(`Rendered Resumed page ${page}`);
});

it("cold offline cache miss starts its first real selected-page request on reconnect", async () => {
  const request = deferred<Pages>(); state.open.mockReturnValue(request.promise);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); mount();
  await screen.findByText("These document pages are not saved on this device. Connect to open them."); expect(state.open).not.toHaveBeenCalled();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(async () => {window.dispatchEvent(new Event("online"));});
  await waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
  await act(async () => {request.resolve(pages());}); await screen.findByText(`Rendered Saved page ${page}`);
});
