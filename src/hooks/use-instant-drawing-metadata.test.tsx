import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import {
  useInstantDrawingMetadata,
  type DrawingSetList,
  type DrawingSetDetail,
} from "./use-instant-drawing-metadata";
import { useDrawingSnapshot } from "~/components/jobs/useDrawingSnapshot";
const state = vi.hoisted(() => ({
  move: vi.fn(),
  rename: vi.fn(),
  notify: vi.fn(),
  invalidateSets: vi.fn(),
  invalidateSet: vi.fn(),
  invalidateIndex: vi.fn(),
  invalidateWorkspace: vi.fn(),
  saveSnapshot: vi.fn(),
}));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: state.notify }));
vi.mock("~/components/jobs/DrawingAccountProvider", () => {
  const account = {
    accountKey: "org:user",
    store: { readSnapshot: async () => null, saveSnapshot: state.saveSnapshot },
  };
  return { useDrawingAccount: () => account };
});
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (
    route: { tag: string },
    input: { jobId?: string; setId?: string },
  ) => [route.tag, input.jobId ?? input.setId],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawings: { listSets: { tag: "sets" }, getSet: { tag: "set" } },
    useUtils: () => ({
      client: {
        drawings: {
          moveSet: { mutate: state.move },
          renameSheet: { mutate: state.rename },
        },
      },
      drawings: {
        listSets: { invalidate: state.invalidateSets },
        getSet: { invalidate: state.invalidateSet },
      },
      drawingsWorkspace: {
        list: { invalidate: state.invalidateIndex },
        get: { invalidate: state.invalidateWorkspace },
      },
    }),
  },
}));
const job = "11111111-1111-4111-8111-111111111111",
  source = "22222222-2222-4222-8222-222222222222",
  target = "33333333-3333-4333-8333-333333333333",
  child = "44444444-4444-4444-8444-444444444444",
  sheet = "55555555-5555-4555-8555-555555555555";
const setsKey = ["sets", job],
  setKey = ["set", source];
function folders(): DrawingSetList {
  return {
    canManage: true,
    canUpload: true,
    canDelete: false,
    sets: [
      {
        id: source,
        name: "Mechanical",
        parentId: null,
        updatedAt: new Date(0),
        downloadVersion: "v1",
        sheetCount: 1,
        coverImageUrl: null,
      },
      {
        id: target,
        name: "Level 2",
        parentId: null,
        updatedAt: new Date(0),
        downloadVersion: "empty",
        sheetCount: 0,
        coverImageUrl: null,
      },
      {
        id: child,
        name: "Subfolder",
        parentId: source,
        updatedAt: new Date(0),
        downloadVersion: "empty",
        sheetCount: 0,
        coverImageUrl: null,
      },
    ],
  };
}
function detail(): DrawingSetDetail {
  return {
    canManage: true,
    canUpload: true,
    canDelete: false,
    set: { id: source, jobId: job, name: "Mechanical", parentId: null },
    sheets: [
      {
        id: sheet,
        name: "Sheet 1",
        imageUrl: "/synthetic/one.webp",
        width: 2880,
        height: 1800,
        sourceFilename: "fixture.pdf",
      },
    ],
    downloadVersion: "v1",
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
function setup(seed = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  if (seed) {
    client.setQueryData(setsKey, folders());
    client.setQueryData(setKey, detail());
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  for (const fn of Object.values(state)) fn.mockReset();
  state.move.mockResolvedValue({ ok: true });
  state.rename.mockResolvedValue({ ok: true });
  state.saveSnapshot.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

describe("reversible immediate drawing metadata", () => {
  it("moves the folder in the initiating call, preserves download/permission fields, and confirms only after acknowledgement", async () => {
    const { client, wrapper } = setup(),
      pending = deferred<{ ok: true }>(),
      started = vi.fn(),
      confirmed = vi.fn();
    state.move.mockReturnValue(pending.promise);
    const hook = renderHook(
      () =>
        useInstantDrawingMetadata({
          jobId: job,
          setId: source,
          onMoveStarted: started,
          onMoveConfirmed: confirmed,
        }),
      { wrapper },
    );
    const before = client.getQueryData<DrawingSetList>(setsKey)!;
    act(() => {
      hook.result.current.moveSet.mutate({ setId: source, parentId: target });
      const preview = client.getQueryData<DrawingSetList>(setsKey)!;
      expect(preview.sets[0]!.parentId).toBe(target);
      expect(preview.sets[0]!.downloadVersion).toBe("v1");
      expect(preview.canDelete).toBe(before.canDelete);
      expect(started).toHaveBeenCalledOnce();
      expect(confirmed).not.toHaveBeenCalled();
      expect(hook.result.current.acceptedSets()).toBeUndefined();
    });
    await waitFor(() => expect(state.move).toHaveBeenCalledOnce());
    expect(state.move).toHaveBeenCalledWith({
      setId: source,
      parentId: target,
    });
    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
    await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
    expect(hook.result.current.acceptedSets()?.sets[0]!.parentId).toBe(target);
  });
  it("restores a refused move and never announces success", async () => {
    const { client, wrapper } = setup(),
      confirmed = vi.fn();
    state.move.mockRejectedValue(new Error("Forbidden"));
    const before = client.getQueryData(setsKey);
    const hook = renderHook(
      () =>
        useInstantDrawingMetadata({
          jobId: job,
          setId: source,
          onMoveConfirmed: confirmed,
        }),
      { wrapper },
    );
    act(() =>
      hook.result.current.moveSet.mutate({ setId: source, parentId: target }),
    );
    await waitFor(() => expect(hook.result.current.moveSet.isError).toBe(true));
    expect(client.getQueryData(setsKey)).toEqual(before);
    expect(confirmed).not.toHaveBeenCalled();
    expect(state.notify).toHaveBeenCalledWith(
      expect.stringContaining("could not be saved"),
      "error",
    );
  });
  it("rejects a known folder cycle without sending a write", async () => {
    const { client, wrapper } = setup(),
      before = client.getQueryData(setsKey);
    const hook = renderHook(
      () => useInstantDrawingMetadata({ jobId: job, setId: source }),
      { wrapper },
    );
    act(() =>
      hook.result.current.moveSet.mutate({ setId: source, parentId: child }),
    );
    await waitFor(() => expect(hook.result.current.moveSet.isError).toBe(true));
    expect(state.move).not.toHaveBeenCalled();
    expect(client.getQueryData(setsKey)).toEqual(before);
  });
  it("updates the observed sheet name immediately and rolls a permission refusal back", async () => {
    const { client, wrapper } = setup(),
      pending = deferred<{ ok: true }>();
    state.rename.mockReturnValue(pending.promise);
    const hook = renderHook(
      () => {
        const actions = useInstantDrawingMetadata({
          jobId: job,
          setId: source,
        });
        const query = useQuery<DrawingSetDetail>({
          queryKey: setKey,
          queryFn: async () => detail(),
          enabled: false,
        });
        return { actions, data: query.data };
      },
      { wrapper },
    );
    act(() => {
      hook.result.current.actions.renameSheet.mutate({
        sheetId: sheet,
        name: "  Level 2 North  ",
      });
      expect(
        client.getQueryData<DrawingSetDetail>(setKey)!.sheets[0]!.name,
      ).toBe("Level 2 North");
    });
    await waitFor(() =>
      expect(hook.result.current.data!.sheets[0]!.name).toBe("Level 2 North"),
    );
    await waitFor(() => expect(state.rename).toHaveBeenCalledOnce());
    expect(state.rename).toHaveBeenCalledWith({
      sheetId: sheet,
      name: "  Level 2 North  ",
    });
    await act(async () => {
      pending.reject(new Error("Forbidden"));
      try {
        await pending.promise;
      } catch {}
    });
    await waitFor(() =>
      expect(hook.result.current.actions.renameSheet.isError).toBe(true),
    );
    expect(hook.result.current.data!.sheets[0]!.name).toBe("Sheet 1");
    expect(
      client.getQueryData<DrawingSetDetail>(setKey)!.sheets[0]!.imageUrl,
    ).toBe("/synthetic/one.webp");
  });
  it("uses the accepted account snapshot when the live query has no data", async () => {
    const { client, wrapper } = setup(false),
      pending = deferred<{ ok: true }>();
    state.rename.mockReturnValue(pending.promise);
    const hook = renderHook(
      () => useInstantDrawingMetadata({ jobId: job, setId: source }),
      { wrapper },
    );
    act(() => {
      hook.result.current.renameSheet.mutate(
        { sheetId: sheet, name: "Renamed" },
        detail(),
      );
      expect(
        client.getQueryData<DrawingSetDetail>(setKey)!.sheets[0]!.name,
      ).toBe("Renamed");
    });
    await waitFor(() => expect(state.rename).toHaveBeenCalledOnce());
    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
  });
  it("does not restore an older name over an authoritative refresh or resurrect cleared account data", async () => {
    for (const wipe of [false, true]) {
      const { client, wrapper } = setup(),
        pending = deferred<{ ok: true }>();
      state.rename.mockReturnValue(pending.promise);
      const hook = renderHook(
        () => useInstantDrawingMetadata({ jobId: job, setId: source }),
        { wrapper },
      );
      act(() =>
        hook.result.current.renameSheet.mutate({
          sheetId: sheet,
          name: "Mine",
        }),
      );
      await waitFor(() => expect(state.rename).toHaveBeenCalled());
      act(() => {
        if (wipe) client.clear();
        else
          client.setQueryData<DrawingSetDetail>(setKey, {
            ...detail(),
            sheets: [{ ...detail().sheets[0]!, name: "Newer server name" }],
          });
      });
      await act(async () => {
        if (wipe) pending.resolve({ ok: true });
        else pending.reject(new Error("Refused"));
        try {
          await pending.promise;
        } catch {}
      });
      await waitFor(() => expect(state.invalidateSet).toHaveBeenCalled());
      expect(
        client.getQueryData<DrawingSetDetail>(setKey)?.sheets[0]!.name,
      ).toBe(wipe ? undefined : "Newer server name");
      hook.unmount();
      state.rename.mockReset();
      state.invalidateSet.mockClear();
    }
  });
  it("refuses an overlapping rename without sending twice or rolling the first preview away", async () => {
    const { client, wrapper } = setup(),
      pending = deferred<{ ok: true }>();
    state.rename.mockReturnValue(pending.promise);
    const hook = renderHook(
      () => useInstantDrawingMetadata({ jobId: job, setId: source }),
      { wrapper },
    );
    act(() =>
      hook.result.current.renameSheet.mutate({ sheetId: sheet, name: "First" }),
    );
    await waitFor(() => expect(state.rename).toHaveBeenCalledOnce());
    act(() =>
      hook.result.current.renameSheet.mutate({
        sheetId: sheet,
        name: "Second",
      }),
    );
    await waitFor(() =>
      expect(hook.result.current.renameSheet.isError).toBe(true),
    );
    expect(client.getQueryData<DrawingSetDetail>(setKey)!.sheets[0]!.name).toBe(
      "First",
    );
    expect(state.rename).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
    await waitFor(() =>
      expect(hook.result.current.acceptedSet(source)?.sheets[0]!.name).toBe(
        "First",
      ),
    );
  });
  it("rejects offline edits without creating a reconnect queue", async () => {
    const { client, wrapper } = setup(),
      before = client.getQueryData(setKey);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const hook = renderHook(
      () => useInstantDrawingMetadata({ jobId: job, setId: source }),
      { wrapper },
    );
    act(() =>
      hook.result.current.renameSheet.mutate({
        sheetId: sheet,
        name: "Offline",
      }),
    );
    await waitFor(() =>
      expect(hook.result.current.renameSheet.isError).toBe(true),
    );
    expect(state.rename).not.toHaveBeenCalled();
    expect(client.getQueryData(setKey)).toEqual(before);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(state.rename).not.toHaveBeenCalled();
  });
  it("never persists a pending preview and observes acceptance after a refused overlapping edit", async () => {
    const { client, wrapper } = setup(),
      pending = deferred<{ ok: true }>();
    state.rename.mockReturnValue(pending.promise);
    const hook = renderHook(
      () => {
        const actions = useInstantDrawingMetadata({
          jobId: job,
          setId: source,
        });
        const query = useQuery<DrawingSetDetail>({
          queryKey: setKey,
          queryFn: async () => detail(),
          enabled: false,
        });
        useDrawingSnapshot(`drawing-set:${source}`, query.data, undefined, {
          canPersist: actions.canPersistSet,
        });
        return actions;
      },
      { wrapper },
    );
    await waitFor(() => expect(state.saveSnapshot).toHaveBeenCalled());
    state.saveSnapshot.mockClear();
    act(() =>
      hook.result.current.renameSheet.mutate({
        sheetId: sheet,
        name: "Accepted name",
      }),
    );
    const optimistic = client.getQueryData(setKey);
    await waitFor(() => expect(state.rename).toHaveBeenCalledOnce());
    expect(state.saveSnapshot).not.toHaveBeenCalled();
    expect(hook.result.current.acceptedSet(source)).toBeUndefined();
    act(() =>
      hook.result.current.renameSheet.mutate({
        sheetId: sheet,
        name: "Refused overlap",
      }),
    );
    await waitFor(() =>
      expect(hook.result.current.renameSheet.isError).toBe(true),
    );
    expect(state.rename).toHaveBeenCalledOnce();
    expect(state.saveSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ ok: true });
      await pending.promise;
    });
    await waitFor(() =>
      expect(state.saveSnapshot).toHaveBeenCalledWith(
        `drawing-set:${source}`,
        expect.objectContaining({
          sheets: [expect.objectContaining({ name: "Accepted name" })],
        }),
      ),
    );
    expect(client.getQueryData(setKey)).toBe(optimistic);
  });
});
