import { Activity, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClientProvider,
  onlineManager,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "~/server/chat/contracts";
import type * as DraftStorage from "~/lib/job-chat-drafts";
import { ChatViewProvider } from "~/components/chat/ChatViewProvider";
import { createQueryClient } from "~/trpc/query-client";
import { setAppPageActive } from "~/lib/app-page-activity";
import {
  DEVICE_QUERY_DENIED_EVENT,
  DEVICE_QUERY_VERSION,
  captureDeviceReadAuthority,
  decodeDeviceQueries,
  encodeDeviceQueries,
  reportDeviceReadDenial,
  startDeviceQueryCache,
  type DeviceQueryStorage,
} from "~/lib/device-query-cache";
import { JobChatThread } from "./JobChatThread";

type History = {
  messages: ChatMessage[];
  nextBeforeSequence: number | null;
  latestSequence: number;
};
type Overview = {
  userId: string;
  jobName: string;
  joined: boolean;
  canModerate: boolean;
  latestSequence: number;
  unreadCount: number;
  muted: boolean;
};
const state = vi.hoisted(() => ({
  userId: "user-one",
  overview: vi.fn<(input: unknown) => Promise<Overview>>(),
  history: vi.fn<(input: unknown) => Promise<History>>(),
  members: vi.fn<(input: unknown) => Promise<unknown[]>>(),
  send: vi.fn<(input: unknown) => Promise<ChatMessage>>(),
  join: vi.fn<(input: unknown) => Promise<unknown>>(),
  remove: vi.fn<(input: unknown) => Promise<unknown>>(),
  markRead: vi.fn<(input: unknown) => Promise<unknown>>(),
  loadDraft: vi.fn<() => Promise<DraftStorage.ChatDraft | null>>(),
  saveDraft: vi.fn<() => Promise<void>>(),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: state.userId, isLoaded: true }),
}));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => null,
}));
vi.mock("~/components/ui/app-dialogs", () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
}));
vi.mock("~/lib/job-chat-drafts", async (original) => ({
  ...(await original<typeof DraftStorage>()),
  loadChatDraft: state.loadDraft,
  saveChatDraft: state.saveDraft,
}));
// The reader, shared read options, account denial fence, QueryClient and storage
// codec are real. Only the server transport and unrelated draft store are fixtures.
vi.mock("~/trpc/react", () => {
  const key = (name: string, input: unknown) => [
    ["chat", name],
    { input, type: "query" },
  ];
  const query = (
    name: "getOverview" | "history" | "members",
    load: (input: unknown) => Promise<unknown>,
  ) => ({
    _def: () => ({ path: ["chat", name] }),
    useQuery(input: unknown, options: UseQueryOptions) {
      return useQuery({
        ...options,
        queryKey: key(name, input),
        queryFn: () => load(input),
        retry: false,
      });
    },
  });
  const mutation = (mutateAsync: (input: unknown) => Promise<unknown>) => ({
    useMutation: () => useMemo(() => ({ mutateAsync, isPending: false }), []),
  });
  return {
    api: {
      useUtils() {
        const client = useQueryClient();
        return useMemo(
          () => ({
            client: {chat: {join: {mutate: state.join}}},
            chat: {
              getOverview: {
                fetch: (input: unknown) => client.fetchQuery({queryKey:key("getOverview",input),queryFn:()=>state.overview(input),staleTime:0,retry:false}),
                invalidate: () =>
                  client.invalidateQueries({
                    queryKey: [["chat", "getOverview"]],
                  }),
              },
              history: {
                invalidate: () =>
                  client.invalidateQueries({ queryKey: [["chat", "history"]] }),
                getData: (input: unknown) =>
                  client.getQueryData(key("history", input)),
                setData: (
                  input: unknown,
                  update: (previous: unknown) => unknown,
                ) => client.setQueryData(key("history", input), update),
                fetch: (input: unknown) =>
                  client.fetchQuery({
                    queryKey: key("history", input),
                    queryFn: () => state.history(input),
                    staleTime: 0,
                    retry: false,
                  }),
              },
            },
          }),
          [client],
        );
      },
      chat: {
        getOverview: query("getOverview", state.overview),
        history: query("history", state.history),
        members: query("members", state.members),
        send: mutation(state.send),
        join: mutation(state.join),
        delete: mutation(state.remove),
        markRead: mutation(state.markRead),
      },
    },
  };
});

const jobId = "11111111-1111-4111-8111-111111111111";
const historyKey = [
  ["chat", "history"],
  { input: { jobId, limit: 50 }, type: "query" },
];
const overviewKey = [
  ["chat", "getOverview"],
  { input: { jobId }, type: "query" },
];
const clients: QueryClient[] = [];
const caches: ReturnType<typeof startDeviceQueryCache>[] = [];
let online: { mockReturnValue(value: boolean): unknown };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function message(sequence = 51, body = "Saved job message"): ChatMessage {
  return {
    id: `message-${sequence}`,
    jobId,
    sequence,
    body,
    clientId: `server-${sequence}`,
    author: { id: "coworker", name: "Crew", image: null },
    createdAt: new Date("2026-11-01T12:00:00Z"),
    editedAt: null,
    deletedAt: null,
    replyToId: null,
    attachments: [],
  };
}
function overview(joined = true) {
  return {
    userId: state.userId,
    jobName: "Job",
    joined,
    canModerate: false,
    latestSequence: 51,
    unreadCount: 0,
    muted: false,
  };
}
function history(messages = [message()]): History {
  return {
    messages,
    nextBeforeSequence: 51,
    latestSequence: messages.at(-1)?.sequence ?? 0,
  };
}
function memoryStorage(): DeviceQueryStorage {
  let value: Awaited<ReturnType<DeviceQueryStorage["read"]>>;
  return {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    clear: async () => {
      value = undefined;
    },
  };
}
function client() {
  const value = createQueryClient();
  clients.push(value);
  return value;
}
async function fixture(saved = true) {
  const store = memoryStorage();
  if (saved) {
    const source = client();
    source.setQueryDefaults(historyKey, {
      meta: { deviceJobChatHistory: true },
    });
    source.setQueryData(historyKey, history());
    await store.write({
      account: "org:user-one",
      version: DEVICE_QUERY_VERSION,
      payload: encodeDeviceQueries(source),
    });
  }
  const queries = client(),
    cache = startDeviceQueryCache(queries, "org:user-one", store);
  caches.push(cache);
  await cache.ready;
  const view = (
    scope = "org:user-one",
    mode: "visible" | "hidden" = "visible",
  ) => (
    <QueryClientProvider client={queries}>
      <Fence>
        <Activity mode={mode}>
          <ChatViewProvider key={scope} scope={scope}>
            <JobChatThread jobId={jobId} />
          </ChatViewProvider>
        </Activity>
      </Fence>
    </QueryClientProvider>
  );
  return { queries, cache, store, view };
}
function Fence({ children }: { children: ReactNode }) {
  const [locked, lock] = useState(false);
  useEffect(() => {
    const deny = () => lock(true);
    window.addEventListener(DEVICE_QUERY_DENIED_EVENT, deny);
    return () => window.removeEventListener(DEVICE_QUERY_DENIED_EVENT, deny);
  }, []);
  return locked ? <p role="alert">Workspace locked</p> : children;
}
function setOnline(value: boolean) {
  act(() => {
    online.mockReturnValue(value);
    onlineManager.setOnline(value);
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  state.userId = "user-one";
  online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  onlineManager.setOnline(true);
  setAppPageActive(true);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.stubGlobal("EventSource", undefined);
  state.overview.mockResolvedValue(overview());
  state.history.mockResolvedValue(history());
  state.members.mockResolvedValue([]);
  state.markRead.mockResolvedValue({});
  state.join.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  state.loadDraft.mockResolvedValue(null);
  state.saveDraft.mockResolvedValue(undefined);
});
afterEach(async () => {
  cleanup();
  for (const cache of caches.splice(0)) await cache.stop();
  for (const value of clients.splice(0)) value.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
  setAppPageActive(true);
});

it("paints saved acknowledged rows before the unresolved overview, without sending, joining, marking read or trusting cached moderation", async () => {
  const pendingOverview = deferred<ReturnType<typeof overview>>(),
    pendingHistory = deferred<History>();
  state.overview.mockReturnValue(pendingOverview.promise);
  state.history.mockReturnValue(pendingHistory.promise);
  const app = await fixture();
  app.queries.setQueryData(overviewKey, { ...overview(), canModerate: true });
  render(app.view());
  expect(await screen.findByText("Saved job message")).toBeVisible();
  await waitFor(() => expect(state.overview).toHaveBeenCalled());
  await act(async () => {
    app.queries.setQueryData(overviewKey, { ...overview(), canModerate: true });
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Private unsent draft" },
  });
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  fireEvent.submit(
    screen.getByRole("textbox", { name: "Message" }).closest("form")!,
  );
  fireEvent.contextMenu(screen.getAllByLabelText(/Message from Crew/).at(-1)!);
  expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(state.history).not.toHaveBeenCalled();
  expect(state.markRead).not.toHaveBeenCalled();
  expect(state.join).not.toHaveBeenCalled();
  expect(state.send).not.toHaveBeenCalled();
  await act(async () => pendingOverview.resolve(overview()));
  await waitFor(() => expect(state.history).toHaveBeenCalled());
  expect(
    screen.getByRole("button", { name: "Send message" }),
  ).not.toBeDisabled();
  await act(async () =>
    pendingHistory.resolve(history([message(51, "Remote edited message")])),
  );
  expect(await screen.findByText("Remote edited message")).toBeVisible();
  expect(screen.queryByText("Saved job message")).toBeNull();
  await app.cache.flush();
  const payload = (await app.store.read())!.payload;
  expect(payload).not.toContain("Private unsent draft");
  expect(payload).not.toContain("canModerate");
  expect(decodeDeviceQueries(payload).mutations).toEqual([]);
  expect(
    app.queries.getQueryData<History>(historyKey)!.messages[0]!.createdAt,
  ).toBeInstanceOf(Date);
});

it("shows saved recent rows offline even when the saved reading range needs missing older pages", async () => {
  setOnline(false);
  sessionStorage.setItem(
    "foremanhq-chat-view:org:user-one",
    JSON.stringify({ [`range:job:user-one:${jobId}:false`]: 1 }),
  );
  const app = await fixture();
  render(app.view());
  expect(await screen.findByText("Saved job message")).toBeVisible();
  expect(screen.getByLabelText("Messages")).not.toHaveStyle({
    visibility: "hidden",
  });
  expect(screen.queryByText(/Restoring earlier/)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Load earlier messages" }),
  ).toBeDisabled();
  expect(state.overview).not.toHaveBeenCalled();
  expect(state.history).not.toHaveBeenCalled();
  expect(state.markRead).not.toHaveBeenCalled();
  expect(state.join).not.toHaveBeenCalled();
});

it("does not let a manual overview replacement reuse earlier server authority", async () => {
  const app = await fixture();
  render(app.view());
  await screen.findByText("Saved job message");
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep my draft" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).not.toBeDisabled(),
  );
  await waitFor(() =>
    expect(app.queries.getQueryState(overviewKey)?.fetchStatus).toBe("idle"),
  );
  await act(async () => {
    app.queries.setQueryData(
      overviewKey,
      app.queries.getQueryData(overviewKey),
    );
  });
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  await act(async () => {
    app.queries.setQueryData(overviewKey, {
      ...overview(false),
      canModerate: true,
    });
  });
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(state.join).not.toHaveBeenCalled();
  fireEvent.submit(
    screen.getByRole("textbox", { name: "Message" }).closest("form")!,
  );
  expect(state.send).not.toHaveBeenCalled();
});

it("describes an offline cache miss honestly instead of inventing an empty conversation", async () => {
  setOnline(false);
  const app = await fixture(false);
  render(app.view());
  expect(
    await screen.findByText(/No saved messages on this device/),
  ).toBeVisible();
  expect(screen.queryByText(/No messages yet/)).toBeNull();
  expect(state.overview).not.toHaveBeenCalled();
  expect(state.history).not.toHaveBeenCalled();
});

it("keeps an online cache miss loading while overview access is unresolved", async () => {
  state.overview.mockReturnValue(new Promise(() => undefined));
  const app = await fixture(false);
  render(app.view());
  expect(await screen.findByText("Loading messages…")).toBeVisible();
  expect(screen.queryByText(/No messages yet/)).toBeNull();
  expect(state.join).not.toHaveBeenCalled();
  expect(state.markRead).not.toHaveBeenCalled();
});

it("does not auto-join from retained overview state until a fresh overview response confirms the account", async () => {
  const request = deferred<ReturnType<typeof overview>>();
  state.overview.mockReturnValue(request.promise);
  const app = await fixture();
  app.queries.setQueryData(overviewKey, overview(false));
  render(app.view());
  await screen.findByText("Saved job message");
  expect(state.join).not.toHaveBeenCalled();
  await act(async () => request.resolve(overview(false)));
  await waitFor(() => expect(state.join).toHaveBeenCalledOnce());
  expect(state.markRead).not.toHaveBeenCalled();
  expect(state.history).not.toHaveBeenCalled();
});

it("retains saved rows and the draft through a transport outage, then waits for new authority on reconnect", async () => {
  state.overview.mockRejectedValue(new Error("HTTP 502 gateway unavailable"));
  const app = await fixture();
  render(app.view());
  expect(await screen.findByText("Saved job message")).toBeVisible();
  await screen.findByText(/Chat is temporarily unavailable/);
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep this draft" },
  });
  await app.cache.flush();
  expect((await app.store.read())!.payload).toContain("Saved job message");
  expect(state.markRead).not.toHaveBeenCalled();
  setOnline(false);
  const request = deferred<ReturnType<typeof overview>>();
  state.overview.mockReturnValue(request.promise);
  setOnline(true);
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  await act(async () => request.resolve(overview()));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).not.toBeDisabled(),
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this draft",
  );
  expect(state.send).not.toHaveBeenCalled();
});

it("requires another successful overview on page reactivation even when successful responses share a timestamp", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const app = await fixture();
  render(app.view());
  await screen.findByText("Saved job message");
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep on this device" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).not.toBeDisabled(),
  );
  act(() => setAppPageActive(false));
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  const request = deferred<ReturnType<typeof overview>>();
  state.overview.mockReturnValue(request.promise);
  act(() => setAppPageActive(true));
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(screen.getByText("Saved job message")).toBeVisible();
  await act(async () => request.resolve(overview()));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).not.toBeDisabled(),
  );
  expect(state.send).not.toHaveBeenCalled();
});

it("requires fresh permissions after a real Activity hide/show without changing global page activity", async () => {
  state.overview.mockResolvedValue({ ...overview(), canModerate: true });
  const app = await fixture(),
    mounted = render(app.view());
  await screen.findByText("Saved job message");
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Retained draft" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).not.toBeDisabled(),
  );
  await waitFor(() =>
    expect(app.queries.getQueryState(overviewKey)?.fetchStatus).toBe("idle"),
  );
  fireEvent.contextMenu(screen.getByLabelText(/Message from Crew/));
  expect(screen.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  fireEvent.keyDown(window, { key: "Escape" });
  mounted.rerender(app.view("org:user-one", "hidden"));
  state.markRead.mockClear();
  state.join.mockClear();
  state.send.mockClear();
  const request = deferred<ReturnType<typeof overview>>();
  state.overview.mockReturnValue(request.promise);
  await act(async () => {
    app.queries.setQueryData(
      historyKey,
      history([message(52, "Saved while hidden")]),
    );
  });
  mounted.rerender(app.view());
  expect(screen.getByText("Saved while hidden")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Retained draft",
  );
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  fireEvent.submit(
    screen.getByRole("textbox", { name: "Message" }).closest("form")!,
  );
  fireEvent.contextMenu(screen.getAllByLabelText(/Message from Crew/).at(-1)!);
  expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(state.join).not.toHaveBeenCalled();
  expect(state.markRead).not.toHaveBeenCalled();
  expect(state.send).not.toHaveBeenCalled();
  await act(async () => request.resolve(overview()));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).not.toBeDisabled(),
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Retained draft",
  );
});

it.each(["overview", "history", "members"] as const)(
  "hides and wipes saved history after a %s authority denial",
  async (name) => {
    const denied = Object.assign(new Error("Access revoked"), {
      data: { code: "FORBIDDEN" },
    });
    state[name].mockRejectedValue(denied);
    const app = await fixture();
    render(app.view());
    if (name === "members") {
      await screen.findByText("Saved job message");
      await waitFor(() => expect(state.markRead).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("button", { name: "People" }));
    }
    expect(await screen.findByText("Workspace locked")).toBeVisible();
    expect(screen.queryByText("Saved job message")).toBeNull();
    await app.cache.flush();
    expect(await app.store.read()).toBeUndefined();
    expect(app.queries.getQueryData(historyKey)).toBeUndefined();
  },
);

it("fences imperative older-history fetch denials even without a mounted observer for that cursor", async () => {
  const app = await fixture();
  render(app.view());
  await screen.findByText("Saved job message");
  await act(async () => {
    await app.queries
      .fetchQuery({
        queryKey: [
          ["chat", "history"],
          { input: { jobId, beforeSequence: 51, limit: 50 }, type: "query" },
        ],
        retry: false,
        queryFn: async () => {
          throw Object.assign(new Error("Gone"), { data: { httpStatus: 410 } });
        },
      })
      .catch(() => undefined);
  });
  expect(await screen.findByText("Workspace locked")).toBeVisible();
  await app.cache.flush();
  expect(await app.store.read()).toBeUndefined();
});

it("keeps a server-acknowledged send in memory until an actual history page exists and never persists an unsent draft", async () => {
  const response = deferred<History>(),
    send = deferred<ChatMessage>();
  state.history.mockReturnValue(response.promise);
  state.send.mockReturnValue(send.promise);
  const app = await fixture(false);
  render(app.view());
  await waitFor(() => expect(state.history).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "My message" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
  await app.cache.flush();
  expect(
    decodeDeviceQueries((await app.store.read())!.payload).queries,
  ).toEqual([]);
  const accepted = {
    ...message(52, "My message"),
    author: { id: "user-one", name: "You", image: null },
  };
  await act(async () => send.resolve(accepted));
  expect(await screen.findByText("My message")).toBeVisible();
  expect(app.queries.getQueryData(historyKey)).toBeUndefined();
  await app.cache.flush();
  expect(
    decodeDeviceQueries((await app.store.read())!.payload).queries,
  ).toEqual([]);
  await act(async () => response.resolve(history([accepted])));
  await app.cache.flush();
  expect((await app.store.read())!.payload).toContain("My message");
});

it("drops restored rows and old in-flight success/denial when another account binds", async () => {
  const oldRequest = deferred<ReturnType<typeof overview>>();
  state.overview.mockReturnValue(oldRequest.promise);
  const app = await fixture(),
    oldAuthority = captureDeviceReadAuthority(),
    mounted = render(app.view());
  await screen.findByText("Saved job message");
  await act(async () => {
    await app.cache.stop();
    state.userId = "user-two";
    state.overview.mockResolvedValue(overview());
    state.history.mockResolvedValue(history([]));
    const next = startDeviceQueryCache(app.queries, "org:user-two", app.store);
    caches.push(next);
    await next.ready;
  });
  mounted.rerender(app.view("org:user-two"));
  expect(screen.queryByText("Saved job message")).toBeNull();
  await act(async () =>
    oldRequest.resolve({ ...overview(), userId: "user-one" }),
  );
  expect(
    reportDeviceReadDenial(
      "chat.history",
      "query",
      { data: { code: "FORBIDDEN" } },
      oldAuthority,
    ),
  ).toBe(false);
  await waitFor(() =>
    expect(
      app.queries.getQueryData<ReturnType<typeof overview>>(overviewKey)
        ?.userId,
    ).toBe("user-two"),
  );
  expect(screen.queryByText("Saved job message")).toBeNull();
  expect(encodeDeviceQueries(app.queries)).not.toContain("Saved job message");
});

it("same-turn manual join cannot duplicate auto-join or unlock history before a real overview", async () => {
  const request = deferred<unknown>();
  state.join.mockReturnValue(request.promise);
  state.overview.mockResolvedValue(overview(false));
  const app = await fixture();
  render(app.view());
  await waitFor(() => expect(state.join).toHaveBeenCalledOnce());
  const button = screen.getByRole("button", {name: "Joining…"});
  fireEvent.click(button); fireEvent.click(button);
  expect(state.join).toHaveBeenCalledOnce();
  expect(state.history).not.toHaveBeenCalled();
  const refresh = deferred<Overview>();state.overview.mockReturnValue(refresh.promise);
  await act(async () => request.resolve({}));
  await waitFor(() => expect(screen.getByRole("button", {name:"Join job chat"})).toBeEnabled());
  expect(state.history).not.toHaveBeenCalled();
  await act(async () => refresh.resolve(overview(true)));
  await waitFor(() => expect(state.history).toHaveBeenCalled());
});
