import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadonlyJSONValue, WriteTransaction } from "replicache";
import type { MaterialListReplicacheMutators } from "./replicache-material-list";

const captured = vi.hoisted(() => ({
  mutators: null as MaterialListReplicacheMutators | null,
}));
vi.mock("replicache", () => ({
  Replicache: class {
    constructor(options: { mutators: MaterialListReplicacheMutators }) {
      captured.mutators = options.mutators;
    }
  },
  dropDatabase: vi.fn(),
}));
import { getMaterialListReplicache } from "./replicache-material-list";

const rows = new Map<string, ReadonlyJSONValue>();
const tx = {
  get: async (key: string) => rows.get(key),
  put: async (key: string, value: ReadonlyJSONValue) => {
    rows.set(key, value);
  },
} as unknown as WriteTransaction;
beforeEach(() => {
  rows.clear();
  getMaterialListReplicache();
});
const mutators = () => captured.mutators!;
const listArgs = {
  materialListId: "list",
  jobId: "job",
  name: "Kitchen — October 3, 2026",
  roomId: "kitchen",
  roomName: "Kitchen",
};
const addArgs = {
  materialListId: "list",
  itemId: "item",
  partDefinitionId: "part",
  quantity: 2,
};

describe("offline material room attribution", () => {
  it("retains a room request's ID and name and inherits it for new parts", async () => {
    await mutators().createMaterialList(tx, listArgs);
    await mutators().addItem(tx, addArgs);
    expect(rows.get("materialList/list")).toMatchObject({
      roomId: "kitchen",
      roomName: "Kitchen",
    });
    expect(rows.get("materialListItem/item")).toMatchObject({
      roomId: "kitchen",
      roomName: "Kitchen",
      quantity: "2",
    });
  });

  it("leaves ordinary list parts blank, including older cached lists without room fields", async () => {
    rows.set("materialList/list", { id: "list", jobId: "job" });
    await mutators().addItem(tx, addArgs);
    expect(rows.get("materialListItem/item")).toMatchObject({
      roomId: null,
      roomName: null,
    });
  });

  it("allows explicit blank and another room without borrowing the list's room name", async () => {
    await mutators().createMaterialList(tx, listArgs);
    await mutators().addItem(tx, { ...addArgs, roomId: null });
    expect(rows.get("materialListItem/item")).toMatchObject({
      roomId: null,
      roomName: null,
    });
    await mutators().addItem(tx, {
      ...addArgs,
      itemId: "other",
      roomId: "hall",
    });
    expect(rows.get("materialListItem/other")).toMatchObject({
      roomId: "hall",
      roomName: null,
    });
  });

  it("keeps attribution through list renaming, quantities, and supplier changes", async () => {
    await mutators().createMaterialList(tx, listArgs);
    await mutators().addItem(tx, addArgs);
    await mutators().renameMaterialList(tx, {
      materialListId: "list",
      name: "Renamed",
    });
    await mutators().updateItemQuantity(tx, {
      materialListId: "list",
      itemId: "item",
      quantity: 5,
    });
    await mutators().updateItemSupplierPart(tx, {
      materialListId: "list",
      itemId: "item",
      supplierId: "supplier",
      supplierPartId: "supplier-part",
    });
    expect(rows.get("materialList/list")).toMatchObject({
      roomId: "kitchen",
      name: "Renamed",
    });
    expect(rows.get("materialListItem/item")).toMatchObject({
      roomId: "kitchen",
      roomName: "Kitchen",
      quantity: "5",
    });
  });

  it("keeps identical parts in different rooms as separate lines", async () => {
    await mutators().createMaterialList(tx, listArgs);
    await mutators().addItem(tx, addArgs);
    await mutators().addItem(tx, {
      ...addArgs,
      itemId: "hall-part",
      roomId: "hall",
      roomName: "Hall",
    });
    expect(rows.get("materialListItem/item")).toMatchObject({
      roomId: "kitchen",
    });
    expect(rows.get("materialListItem/hall-part")).toMatchObject({
      roomId: "hall",
    });
  });
});

it("keeps offline demand separate and replaces supplier rounding when switching suppliers", async () => {
  await mutators().createMaterialList(tx, listArgs);
  const supplier = {
    id: "supplier-part",
    supplierId: "supplier",
    supplierSku: null,
    lastKnownUnitCost: "2",
    packSize: "25",
    supplier: { id: "supplier", name: "Supplier" },
  };
  await mutators().addItem(tx, {
    ...addArgs,
    quantity: 37,
    unitCost: 2,
    supplierPartSnapshot: supplier,
  });
  expect(rows.get("materialListItem/item")).toMatchObject({
    quantity: "37",
    extendedPrice: "100",
  });
  await mutators().updateItemQuantity(tx, {
    materialListId: "list",
    itemId: "item",
    quantity: 51,
  });
  expect(rows.get("materialListItem/item")).toMatchObject({
    quantity: "51",
    extendedPrice: "150",
  });
  await mutators().updateItemSupplierPart(tx, {
    materialListId: "list",
    itemId: "item",
    supplierPartId: "other-part",
    supplierId: "other",
    unitCost: 2,
    supplierPartSnapshot: { ...supplier, id: "other-part", packSize: "10" },
  });
  expect(rows.get("materialListItem/item")).toMatchObject({
    quantity: "51",
    extendedPrice: "120",
    supplierPart: { packSize: "10" },
  });
});


it("retains pack contents offline and charges only whole packs on edits", async () => {
  await mutators().addItem(tx, {
    ...addArgs, quantity: .2, unitCost: 25,
    partDefinitionSnapshot: { id: "part", displayName: "Clips box", imageUrl: null, material: null, piecesPerPack: 50 },
  });
  expect(rows.get("materialListItem/item")).toMatchObject({quantity: "0.2", extendedPrice: "25", partDefinition: {piecesPerPack: 50}});
  await mutators().updateItemQuantity(tx, {materialListId: "list", itemId: "item", quantity: 1.4});
  expect(rows.get("materialListItem/item")).toMatchObject({quantity: "1.4", extendedPrice: "50"});
  await mutators().updateItemSupplierPart(tx, {materialListId: "list", itemId: "item", supplierPartId: "new", supplierId: "new-supplier", unitCost: 30});
  expect(rows.get("materialListItem/item")).toMatchObject({quantity: "1.4", extendedPrice: "60"});
});


it("keeps a sent row unchanged during optimistic edits and deletion", async () => {
  const locked = { id: "item", materialListId: "list", sentOrderItemId: "order-line", quantity: "2" };
  rows.set("materialListItem/item", locked);
  await mutators().updateItemQuantity(tx, { materialListId: "list", itemId: "item", quantity: 8 });
  await mutators().updateItemSupplierPart(tx, { materialListId: "list", itemId: "item", supplierPartId: null, supplierId: null });
  await mutators().removeItem(tx, { materialListId: "list", itemId: "item" });
  expect(rows.get("materialListItem/item")).toEqual(locked);
});
