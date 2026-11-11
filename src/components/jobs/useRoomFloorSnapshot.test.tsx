import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useQuery,
} from "@tanstack/react-query";
import {
  blocksCachedRead,
  useTierOneReadOptions,
} from "~/hooks/use-tier-one-read-options";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  DrawingOfflineStore,
  setDrawingOfflineAccount,
} from "~/lib/drawing-offline";
import { roomFloorKey } from "~/lib/room-snapshots";
import { createDemoRooms } from "~/components/tutorial/tutorial-sandbox-fixtures";
import type { RouterOutputs } from "~/trpc/react";
import { useRoomFloorSnapshot } from "./useRoomFloorSnapshot";
const state = vi.hoisted(() => ({
  account: null as { accountKey: string; store: DrawingOfflineStore } | null,
}));
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => state.account,
}));
type Floor = RouterOutputs["rooms"]["getFloorRooms"];
const clients: QueryClient[] = [];
const saved = { ...createDemoRooms().floors[0]!, name: "Saved floor" } as Floor;
function View({
  id = saved.id,
  live,
  error,
  online = true,
}: {
  id?: string;
  live?: Floor;
  error?: unknown;
  online?: boolean;
}) {
  const result = useRoomFloorSnapshot("job", id, live, error, online);
  return <div>{result.data?.name ?? "Waiting for floor"}</div>;
}
beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await setDrawingOfflineAccount("org:alice");
  state.account = {
    accountKey: "org:alice",
    store: new DrawingOfflineStore("org:alice"),
  };
  await state.account.store.clear();
});
afterEach(async () => {
  cleanup();
  state.account?.store.dispose();
  await setDrawingOfflineAccount(null);
  state.account = null;
  for (const client of clients.splice(0)) client.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("paints the exact saved floor while live data is pending, then authoritative success replaces it", async () => {
  await state.account!.store.saveSnapshot(roomFloorKey("job", saved.id), saved);
  const view = render(<View />);
  await screen.findByText("Saved floor");
  view.rerender(<View live={{ ...saved, name: "Server floor" }} />);
  expect(screen.getByText("Server floor")).toBeTruthy();
  view.rerender(
    <View
      live={{ ...saved, name: "Server floor" }}
      error={{ data: { code: "FORBIDDEN" } }}
    />,
  );
  expect(screen.getByText("Waiting for floor")).toBeTruthy();
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByText("Saved floor")).toBeNull();
});
it("keeps saved data on transient failure and never reads a different floor or another account", async () => {
  await state.account!.store.saveSnapshot(roomFloorKey("job", saved.id), saved);
  const view = render(<View error={new Error("Network failed")} />);
  await screen.findByText("Saved floor");
  view.rerender(<View id="not-saved" />);
  expect(screen.queryByText("Saved floor")).toBeNull();
  state.account!.store.dispose();
  await setDrawingOfflineAccount("org:bob");
  state.account = {
    accountKey: "org:bob",
    store: new DrawingOfflineStore("org:bob"),
  };
  view.rerender(<View />);
  await waitFor(() =>
    expect(screen.getByText("Waiting for floor")).toBeTruthy(),
  );
});
it("does not expand a missing online floor to legacy data but recovers that legacy floor offline", async () => {
  await state.account!.store.saveSnapshot("room-sheets:job", {
    ...createDemoRooms(),
    floors: [saved],
  });
  const read = vi.spyOn(state.account!.store, "readSnapshot");
  const view = render(<View />);
  await waitFor(() =>
    expect(read).toHaveBeenCalledWith(roomFloorKey("job", saved.id)),
  );
  expect(read).not.toHaveBeenCalledWith("room-sheets:job");
  expect(screen.getByText("Waiting for floor")).toBeTruthy();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  view.rerender(<View online={false} />);
  await screen.findByText("Saved floor");
  expect(read).toHaveBeenCalledWith("room-sheets:job");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function QueryFloor({ load }: { load: () => Promise<Floor> }) {
  const key = [
    ["rooms", "getFloorRooms"],
    { input: { floorId: saved.id }, type: "query" },
  ];
  const query = useQuery({
    queryKey: key,
    queryFn: load,
    retry: false,
    ...useTierOneReadOptions(key),
  });
  const snapshot = useRoomFloorSnapshot(
    "job",
    saved.id,
    query.data,
    query.error,
    true,
  );
  return (
    <div>
      {blocksCachedRead({ ...query, data: snapshot.data })
        ? "Floor access refused"
        : (snapshot.data?.name ?? "Waiting for floor")}
    </div>
  );
}
function renderQuery(load: () => Promise<Floor>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 300_000 } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <QueryFloor load={load} />
    </QueryClientProvider>,
  );
}
it("cold online QueryClient paints disk floor before deferred network response and replaces it on success", async () => {
  await state.account!.store.saveSnapshot(roomFloorKey("job", saved.id), saved);
  const request = deferred<Floor>(),
    load = vi.fn(() => request.promise);
  renderQuery(load);
  await screen.findByText("Saved floor");
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => {
    request.resolve({ ...saved, name: "Authoritative floor" });
  });
  await screen.findByText("Authoritative floor");
});
it.each([false, true])(
  "deferred refresh refusal preserves transient data or blocks authority denial (%s)",
  async (denied) => {
    await state.account!.store.saveSnapshot(
      roomFloorKey("job", saved.id),
      saved,
    );
    const request = deferred<Floor>();
    renderQuery(() => request.promise);
    await screen.findByText("Saved floor");
    const error = Object.assign(
      new Error(denied ? "Forbidden" : "Network failed"),
      denied ? { data: { code: "FORBIDDEN" } } : {},
    );
    await act(async () => {
      request.reject(error);
    });
    if (denied) {
      await screen.findByText("Floor access refused");
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      expect(screen.queryByText("Saved floor")).toBeNull();
    } else {
      await waitFor(() =>
        expect(clients.at(-1)!.getQueryCache().getAll()[0]!.state.status).toBe(
          "error",
        ),
      );
      expect(screen.getByText("Saved floor")).toBeTruthy();
    }
  },
);
