import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import {
  DrawingOfflineStore,
  setDrawingOfflineAccount,
} from "~/lib/drawing-offline";
import * as roomSnapshots from "~/lib/room-snapshots";
import { createDemoRooms } from "~/components/tutorial/tutorial-sandbox-fixtures";
import type { RouterOutputs } from "~/trpc/react";
import { useTierOneReadOptions } from "~/hooks/use-tier-one-read-options";
import { DrawingAccountProvider } from "./DrawingAccountProvider";
import { useRoomFloorSnapshot } from "./useRoomFloorSnapshot";
// Only unrelated renderer cleanup is stubbed; account/provider/query authority and
// IndexedDB persistence/denial purge are real in this integration.
vi.mock("~/lib/pdf-client", () => ({ clearPdfDocuments: vi.fn() }));
vi.mock("~/lib/drawing-text", () => ({ clearDrawingTextIndexes: vi.fn() }));
type Floor = RouterOutputs["rooms"]["getFloorRooms"];
const saved = {
  ...createDemoRooms().floors[0]!,
  name: "Private saved floor",
} as Floor;
const clients: QueryClient[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function FloorRead({ load }: { load: () => Promise<Floor> }) {
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
  return <p>{snapshot.data?.name ?? "Waiting for selected floor"}</p>;
}
afterEach(async () => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  await setDrawingOfflineAccount(null);
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("real provider locks after floor denial and a delayed disk result/reconnect cannot restore private content", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await setDrawingOfflineAccount("org:alice");
  const seed = new DrawingOfflineStore("org:alice");
  await seed.saveSnapshot(roomSnapshots.roomFloorKey("job", saved.id), saved);
  seed.dispose();
  const readStarted = deferred<void>(),
    releaseRead = deferred<void>();
  const actualRead = roomSnapshots.readCurrentRoomFloorSnapshot;
  vi.spyOn(roomSnapshots, "readCurrentRoomFloorSnapshot").mockImplementation(
    async (store, key) => {
      const value = await actualRead(store, key);
      expect(value?.name).toBe("Private saved floor");
      readStarted.resolve();
      await releaseRead.promise;
      return value;
    },
  );
  const network = deferred<Floor>(),
    load = vi.fn(() => network.promise);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <DrawingAccountProvider userId="alice" organizationId="org">
        <FloorRead load={load} />
      </DrawingAccountProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("Waiting for selected floor");
  await act(async () => {
    await readStarted.promise;
  });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  await act(async () => {
    network.reject(
      Object.assign(new Error("Forbidden"), { data: { code: "FORBIDDEN" } }),
    );
  });
  await screen.findByRole("button", { name: "Reload session" });
  await act(async () => {
    releaseRead.resolve();
  });
  expect(screen.queryByText("Private saved floor")).toBeNull();
  await act(async () => {
    onlineManager.setOnline(false);
    window.dispatchEvent(new Event("offline"));
    onlineManager.setOnline(true);
    window.dispatchEvent(new Event("online"));
  });
  expect(screen.getByRole("button", { name: "Reload session" })).toBeTruthy();
  expect(screen.queryByText("Private saved floor")).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
});
