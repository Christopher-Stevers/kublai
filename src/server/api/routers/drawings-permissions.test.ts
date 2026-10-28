// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/drawings/service", () => ({
  assertSheetsNotReferenced: vi.fn(),
}));
vi.mock("~/server/rooms/tiles", () => ({
  ensureDrawingTiles: vi.fn(),
  uploadsFromImageUrls: vi.fn(() => []),
}));
import { drawingsWorkspaceRouter } from "./drawingsWorkspace";
import { pipeSpecsRouter } from "./pipeSpecs";
import { drawingsRouter } from "./drawings";
import { roomsRouter } from "./rooms";
import type { createTRPCContext } from "~/server/api/trpc";
import { toStoredConfig } from "~/server/auth/permissions";
import type { PermissionMap } from "~/lib/permission-catalog";

const id = "00000000-0000-4000-8000-000000000001";
function setup(permissions: Partial<PermissionMap>) {
  const query = Object.assign(Promise.resolve([]), {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(() => query),
  });
  const db = { select: vi.fn(() => query), transaction: vi.fn() };
  const ctx = {
    db,
    userId: "member",
    user: {
      id: "member",
      organizationId: id,
      organizationAccessStatus: "approved",
      role: "user",
      permissionConfig: toStoredConfig(permissions),
    },
    headers: new Headers(),
  } as unknown as Awaited<ReturnType<typeof createTRPCContext>>;
  return {
    db,
    workspace: drawingsWorkspaceRouter.createCaller(ctx),
    specs: pipeSpecsRouter.createCaller(ctx),
    drawings: drawingsRouter.createCaller(ctx),
    rooms: roomsRouter.createCaller(ctx),
  };
}

describe("drawing permission enforcement", () => {
  it("blocks every drawing entry point when card access is disabled, even with upload and delete enabled", async () => {
    const { drawings, db } = setup({
      "drawings.view": false,
      "drawings.upload": true,
      "drawings.delete": true,
    });
    for (const request of [
      () => drawings.listSets({ jobId: id }),
      () => drawings.getSet({ setId: id }),
      () => drawings.createSet({ jobId: id, name: "Test" }),
      () => drawings.renameSheet({ sheetId: id, name: "Test" }),
      () => drawings.deleteSet({ setId: id }),
      () => drawings.deleteSheet({ sheetId: id }),
    ])
      await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.select).not.toHaveBeenCalled();
  });
  it("does not let an uploader delete sheets, folders or floor plans", async () => {
    const { drawings, rooms, db } = setup({
      "drawings.view": true,
      "drawings.upload": true,
      "drawings.delete": false,
    });
    await expect(drawings.deleteSheet({ sheetId: id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(drawings.deleteSet({ setId: id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(rooms.deleteFloor({ floorId: id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("lets delete-only members reach deletion but rejects uploads and renaming", async () => {
    const { drawings, db } = setup({
      "drawings.view": true,
      "drawings.upload": false,
      "drawings.delete": true,
    });
    await expect(
      drawings.createSet({ jobId: id, name: "Test" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      drawings.renameSheet({ sheetId: id, name: "Test" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.select).not.toHaveBeenCalled();
    await expect(drawings.deleteSheet({ sheetId: id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(db.select).toHaveBeenCalledOnce();
  });
});

it("blocks all Sheet tool routes before reading data when disabled", async () => {
  const { workspace, specs, db } = setup({ "drawings.view": true, "drawings.upload": true, "drawings.sheetTools": false });
  const boxes = { title: { left: 0, top: 0, right: 1, bottom: 1 }, number: { left: 0, top: 0, right: 1, bottom: 1 } };
  for (const request of [
    () => workspace.superLabelSettings({ sheetId: id }),
    () => workspace.saveSuperLabelBoxes({ sheetId: id, boxes }),
    () => workspace.applySuperLabel({ sheetId: id, targetId: id, boxes }),
    () => workspace.legendItems({ sheetId: id }),
    () => workspace.scanLegend({ sheetId: id, sourceSheetId: id }),
    () => workspace.updateLegendItem({ sheetId: id, id, revision: 1, data: null }),
    () => workspace.superScaleLatest({ sheetId: id }),
    () => workspace.superScaleStart({ sheetId: id, id }),
    () => workspace.superScaleCancel({ sheetId: id, id }),
    () => workspace.autoHyperlinkSources({ sheetId: id }),
    () => workspace.autoHyperlinkReaders({ sheetId: id }),
    () => workspace.autoHyperlinkDetect({ sheetId: id, sourceSheetId: id, reader: "terra", requestId: id }),
    () => workspace.autoHyperlinkPreview({sheetId:id,tags:["P-1"],scope:"job"}),
    () => workspace.superEquipmentSources({sheetId:id}),
    () => workspace.superEquipmentReport({sheetId:id}),
    () => workspace.recognizeEquipmentSource({sheetId:id,kind:"drawing",id,page:1}),
    () => workspace.autoHyperlinkSave({} as never),
    () => workspace.saveLegendItems({} as never),
    () => specs.assessSpecMaterials({ jobId: id }),
  ]) await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(db.select).not.toHaveBeenCalled();
});
