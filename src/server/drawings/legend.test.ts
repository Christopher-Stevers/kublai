import { beforeEach, describe, expect, it, vi } from "vitest";
const { accessSheet } = vi.hoisted(() => ({ accessSheet: vi.fn() }));
vi.mock("./service", () => ({ accessSheet }));
vi.mock("~/server/db/schema", () => ({
  drawingLegendItems: {},
  jobDrawingSheets: {},
}));
vi.mock("./equipment-index", () => ({
  drawingPdfLocation: vi.fn(),
  equipmentIndex: vi.fn(),
}));
vi.mock("./domain", () => ({ assertRevision: vi.fn() }));
import { legendAccess, saveLegendItems } from "./legend";
import type { DrawingContext } from "./service";
const insert = vi.fn();
const ctx = { db: { insert }, userId: "user" } as unknown as DrawingContext;
const sheet = { id: "sheet", organizationId: "org", setId: "set" };
beforeEach(() => {
  vi.clearAllMocks();
  accessSheet.mockResolvedValue({ sheet, canAnnotate: true });
});
describe("legend scope", () => {
  it("requires fresh drawing access for every operation", async () => {
    accessSheet.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(legendAccess(ctx, "sheet")).rejects.toThrow("Forbidden");
  });
  it("rejects a source from another set even in the same organization", async () => {
    accessSheet
      .mockResolvedValueOnce({ sheet, canAnnotate: true })
      .mockResolvedValueOnce({
        sheet: { ...sheet, id: "source", setId: "other" },
        canAnnotate: true,
      });
    await expect(legendAccess(ctx, "sheet", "source")).rejects.toThrow(
      "this drawing set",
    );
  });
  it("rejects a source from another organization", async () => {
    accessSheet
      .mockResolvedValueOnce({ sheet, canAnnotate: true })
      .mockResolvedValueOnce({
        sheet: { ...sheet, id: "source", organizationId: "other" },
        canAnnotate: true,
      });
    await expect(legendAccess(ctx, "sheet", "source")).rejects.toThrow(
      "this drawing set",
    );
  });
  it("prevents read-only document viewers from writing", async () => {
    accessSheet.mockResolvedValueOnce({ sheet, canAnnotate: false });
    await expect(
      saveLegendItems(ctx, {
        sheetId: "sheet",
        sourceSheetId: "sheet",
        items: [],
      }),
    ).rejects.toThrow("not allowed");
    expect(insert).not.toHaveBeenCalled();
  });
  it("allows source sheets in the authorized set", async () => {
    accessSheet
      .mockResolvedValueOnce({ sheet, canAnnotate: true })
      .mockResolvedValueOnce({
        sheet: { ...sheet, id: "source" },
        canAnnotate: true,
      });
    expect((await legendAccess(ctx, "sheet", "source", true)).source.id).toBe(
      "source",
    );
  });
});
