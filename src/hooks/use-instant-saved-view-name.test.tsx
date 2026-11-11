import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity, useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  DrawingEntity,
  DrawingSave,
  DrawingWorkspace,
} from "~/lib/drawing-workspace";
import {
  eligibleSavedViewName,
  useInstantSavedViewName,
} from "./use-instant-saved-view-name";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  invalidate: vi.fn(),
  notify: vi.fn(),
  account: { accountKey: "org:actor", userId: "actor" },
  authority: {} as object,
}));
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
vi.mock("~/lib/device-query-cache", () => ({
  captureDeviceReadAuthority: () => state.authority,
}));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: state.notify }));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (_: unknown, input: unknown) => ["drawing", input],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: { get: {} },
    useUtils: () => ({
      client: { drawingsWorkspace: { save: { mutate: state.save } } },
      drawingsWorkspace: { get: { invalidate: state.invalidate } },
    }),
  },
}));
const sheet = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const entity: DrawingEntity = {
  id,
  sheetId: sheet,
  kind: "view",
  visibility: "private",
  revision: 3,
  authorId: "actor",
  authorName: "Actor",
  comments: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  data: {
    name: "Old view",
    sourceSheetId: sheet,
    center: { x: 0.5, y: 0.5 },
    zoom: 1,
  },
};
function workspace() {
  return {
    sheetId: sheet,
    actor: { id: "actor" },
    entities: [entity],
  } as DrawingWorkspace;
}
function input(): Extract<DrawingSave, { kind: "view" }> {
  return {
    id,
    sheetId: sheet,
    expectedRevision: 3,
    kind: "view",
    visibility: "private",
    data: {
      ...(entity.data as Extract<DrawingEntity, { kind: "view" }>["data"]),
      name: "New view",
    },
  };
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
function setup() {
  const client = new QueryClient();
  clients.push(client);
  const key = ["drawing", { sheetId: sheet }];
  client.setQueryData(key, workspace());
  const started = vi.fn<(input: DrawingSave) => void>(),
    restore = vi.fn<(input: DrawingSave) => void>();
  let setHidden!: (value: boolean) => void;
  const hook = renderHook(
    () =>
      useInstantSavedViewName({
        sheetId: sheet,
        hyperlinksVisible: true,
        onStarted: started,
        onRestore: restore,
      }),
    {
      wrapper: function Wrapper({ children }: { children: ReactNode }) {
        const [hidden, set] = useState(false);
        setHidden = set;
        return (
          <QueryClientProvider client={client}>
            <Activity mode={hidden ? "hidden" : "visible"}>{children}</Activity>
          </QueryClientProvider>
        );
      },
    },
  );
  return {
    client,
    key,
    hook,
    started,
    restore,
    hide: () => act(() => setHidden(true)),
  };
}
beforeEach(() => {
  state.account = { accountKey: "org:actor", userId: "actor" };
  state.authority = {};
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("changes workspace title cache and invokes editor-close callback in the initiating call, reconciles real revision", async () => {
  const request = deferred<DrawingEntity>();
  state.save.mockReturnValue(request.promise);
  const { client, key, hook, started } = setup();
  act(() => {
    expect(hook.result.current.tryRename(input())).toBe(true);
  });
  expect(
    client.getQueryData<DrawingWorkspace>(key)?.entities[0]?.data,
  ).toMatchObject({ name: "New view" });
  expect(started).toHaveBeenCalledTimes(1);
  expect(
    hook.result.current.canPersist(client.getQueryData<DrawingWorkspace>(key)!),
  ).toBe(false);
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({ expectedUserId: "actor", expectedRevision: 3 }),
    ),
  );
  await act(async () => {
    request.resolve({
      ...entity,
      revision: 4,
      data: { ...input().data, name: "Server view" },
    });
  });
  await waitFor(() =>
    expect(
      client.getQueryData<DrawingWorkspace>(key)?.entities[0]?.revision,
    ).toBe(4),
  );
});
it("rolls back refusal and retains the submitted name as retry draft", async () => {
  const request = deferred<DrawingEntity>();
  state.save.mockReturnValue(request.promise);
  const { client, key, hook, restore } = setup();
  act(() => {
    hook.result.current.tryRename(input());
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  await act(async () => {
    request.reject(new Error("Forbidden"));
  });
  await waitFor(() =>
    expect(restore.mock.calls[0]?.[0].data).toMatchObject({ name: "New view" }),
  );
  expect(client.getQueryData<DrawingWorkspace>(key)?.entities[0]).toEqual(
    entity,
  );
});
it("new server data wins over a late refusal without reopening an obsolete draft", async () => {
  const request = deferred<DrawingEntity>();
  state.save.mockReturnValue(request.promise);
  const { client, key, hook, restore } = setup();
  act(() => {
    hook.result.current.tryRename(input());
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  const newer = { ...workspace(), entities: [{ ...entity, revision: 5 }] };
  client.setQueryData(key, newer);
  await act(async () => {
    request.reject(new Error("Conflict"));
  });
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  expect(client.getQueryData(key)).toEqual(newer);
  expect(restore).not.toHaveBeenCalled();
});
it("refuses overlapping edits and never sends or previews offline", async () => {
  const request = deferred<DrawingEntity>();
  state.save.mockReturnValue(request.promise);
  const { hook, started } = setup();
  act(() => {
    hook.result.current.tryRename(input());
    hook.result.current.tryRename({
      ...input(),
      data: { ...input().data, name: "Second" },
    });
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  expect(started).toHaveBeenCalledTimes(1);
  await act(async () => {
    request.resolve({ ...entity, revision: 4, data: input().data });
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const other = setup();
  act(() => {
    other.hook.result.current.tryRename(input());
  });
  await waitFor(() => expect(state.notify).toHaveBeenCalled());
  expect(other.started).not.toHaveBeenCalled();
  expect(state.save).toHaveBeenCalledTimes(1);
});
it("account wipe and late success cannot restore private data or reopen editor", async () => {
  const request = deferred<DrawingEntity>();
  state.save.mockReturnValue(request.promise);
  const { client, key, hook, restore } = setup();
  act(() => {
    hook.result.current.tryRename(input());
  });
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  state.account = { accountKey: "org:other", userId: "other" };
  state.authority = {};
  client.clear();
  hook.rerender();
  await act(async () => {
    request.resolve({ ...entity, revision: 4, data: input().data });
  });
  expect(client.getQueryData(key)).toBeUndefined();
  expect(restore).not.toHaveBeenCalled();
  expect(state.invalidate).not.toHaveBeenCalled();
});
it("excludes create/public/other-author/revision and every geometric change", () => {
  const original = input();
  for (const edit of [
    { ...original, expectedRevision: 0 },
    { ...original, visibility: "published" as const },
    { ...original, data: { ...original.data, zoom: 2 } },
    { ...original, data: { ...original.data, center: { x: 0.1, y: 0.5 } } },
    { ...original, data: { ...original.data, sourceSheetId: id } },
  ])
    expect(eligibleSavedViewName(edit, workspace())).toBe(false);
  expect(
    eligibleSavedViewName(original, {
      ...workspace(),
      entities: [{ ...entity, authorId: "other" }],
    }),
  ).toBe(false);
});

it.each([
  "hidden-refused",
  "hidden-accepted",
  "unmounted-refused",
  "unmounted-accepted",
] as const)(
  "settles cache after %s without restoring a removed editor",
  async (mode) => {
    const request = deferred<DrawingEntity>();
    state.save.mockReturnValue(request.promise);
    const { client, key, hook, restore, hide } = setup();
    act(() => {
      hook.result.current.tryRename(input());
    });
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    const preview = client.getQueryData<DrawingWorkspace>(key)!;
    if (mode.startsWith("hidden")) hide();
    else hook.unmount();
    await act(async () => {
      if (mode.endsWith("accepted"))
        request.resolve({
          ...entity,
          revision: 4,
          data: { ...input().data, name: "Confirmed view" },
        });
      else request.reject(new Error("Refused"));
    });
    await waitFor(() =>
      expect(
        client.getQueryData<DrawingWorkspace>(key)?.entities[0]?.data,
      ).toMatchObject({
        name: mode.endsWith("accepted") ? "Confirmed view" : "Old view",
      }),
    );
    expect(restore).not.toHaveBeenCalled();
    expect(hook.result.current.canPersist(preview)).toBe(false);
    expect(
      hook.result.current.canPersist(
        client.getQueryData<DrawingWorkspace>(key)!,
      ),
    ).toBe(true);
  },
);
