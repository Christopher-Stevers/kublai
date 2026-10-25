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
} from "./drawing-offline";
import { createDemoRooms } from "~/components/tutorial/tutorial-sandbox-fixtures";
import {
  readRoomFloorSnapshot,
  readRoomOverviewSnapshot,
  roomFloorKey,
  roomOverviewKey,
} from "./room-snapshots";

beforeAll(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});
beforeEach(async () => {
  await setDrawingOfflineAccount("org:alice");
});
afterEach(async () => {
  await setDrawingOfflineAccount(null);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

it("opens previously downloaded legacy rooms without copying geometry into the overview", async () => {
  const store = new DrawingOfflineStore("org:alice");
  const legacy = createDemoRooms();
  const floor = legacy.floors[0]!;
  await store.saveSnapshot("room-sheets:job", legacy);
  const overview = await readRoomOverviewSnapshot(
    store,
    roomOverviewKey("job"),
  );
  expect(overview?.floors[0]).toMatchObject({
    id: floor.id,
    roomCount: 4,
    rooms: [],
  });
  const detail = await readRoomFloorSnapshot(
    store,
    roomFloorKey("job", floor.id),
  );
  expect(detail?.rooms).toEqual(floor.rooms);
  expect(detail?.rooms[0]?.updatedAt).toBeInstanceOf(Date);
  expect(
    await readRoomFloorSnapshot(store, roomFloorKey("job", "not-saved")),
  ).toBeNull();
  store.dispose();
});

it("prefers new per-floor snapshots including an empty floor over outdated legacy data", async () => {
  const store = new DrawingOfflineStore("org:alice");
  const legacy = createDemoRooms(),
    floor = legacy.floors[0]!;
  await store.saveSnapshot("room-sheets:job", legacy);
  await store.saveSnapshot(roomFloorKey("job", floor.id), {
    ...floor,
    rooms: [],
  });
  await store.saveSnapshot(roomOverviewKey("job"), {
    ...legacy,
    floors: [{ ...floor, roomCount: 0, rooms: [] }],
  });
  const read = vi.spyOn(store, "readSnapshot");
  expect(
    (await readRoomFloorSnapshot(store, roomFloorKey("job", floor.id)))?.rooms,
  ).toEqual([]);
  expect(
    (await readRoomOverviewSnapshot(store, roomOverviewKey("job")))?.floors[0]
      ?.roomCount,
  ).toBe(0);
  expect(read).not.toHaveBeenCalledWith("room-sheets:job");
  store.dispose();
});

it("cannot restore another account's legacy or per-floor room snapshots", async () => {
  const alice = new DrawingOfflineStore("org:alice");
  const legacy = createDemoRooms(),
    floor = legacy.floors[0]!;
  await alice.saveSnapshot("room-sheets:job", legacy);
  await alice.saveSnapshot(roomFloorKey("job", floor.id), floor);
  await setDrawingOfflineAccount("org:bob");
  const bob = new DrawingOfflineStore("org:bob");
  expect(
    await readRoomFloorSnapshot(bob, roomFloorKey("job", floor.id)),
  ).toBeNull();
  expect(
    await readRoomOverviewSnapshot(bob, roomOverviewKey("job")),
  ).toBeNull();
  await expect(
    readRoomFloorSnapshot(alice, roomFloorKey("job", floor.id)),
  ).rejects.toThrow();
  bob.dispose();
});
