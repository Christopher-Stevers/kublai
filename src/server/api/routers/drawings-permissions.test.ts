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
