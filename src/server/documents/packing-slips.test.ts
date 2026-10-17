// @vitest-environment node
import { expect, it } from "vitest";
import { appendPackingSlip } from "./packing-slips";
import {
  emptyDocumentState,
  applyDocumentAction,
  type DocumentActor,
} from "./domain";
const actor: DocumentActor = {
  userId: "receiver",
  jobId: "job",
  canWrite: true,
  canManage: false,
  memberIds: ["receiver"],
};
const input = {
  name: "image.jpg",
  size: 100,
  mimeType: "image/jpeg",
  sha256: "a".repeat(64),
};
const link = {
  orderId: "order",
  materialListId: "list",
  orderNumber: "PO-123",
  materialListName: "Level 3",
};
it("creates one Packing Slips folder and links multiple delivery photos without filename collisions", () => {
  const state = emptyDocumentState();
  const first = appendPackingSlip(state, actor, input, link);
  const second = appendPackingSlip(
    state,
    actor,
    { ...input, sha256: "b".repeat(64) },
    link,
  );
  expect(state.folders).toHaveLength(1);
  expect(state.folders[0]?.name).toBe("Packing Slips");
  expect(state.documents).toHaveLength(2);
  expect(first.documentId).not.toBe(second.documentId);
  expect(
    state.documents.every(
      (d) =>
        d.packingSlip?.orderId === "order" &&
        d.packingSlip.materialListId === "list" &&
        d.folderId === state.folders[0]!.id,
    ),
  ).toBe(true);
  expect(new Set(state.documents.map((d) => d.name)).size).toBe(2);
  expect(appendPackingSlip(state, actor, input, link)).toEqual(first);
  expect(state.documents).toHaveLength(2);
});
it("does not silently replace existing documents or accept executable files", () => {
  expect(() =>
    appendPackingSlip(
      emptyDocumentState(),
      actor,
      { ...input, documentId: "other" },
      link,
    ),
  ).toThrow("new attachments");
  expect(() =>
    appendPackingSlip(
      emptyDocumentState(),
      actor,
      { ...input, mimeType: "application/octet-stream" },
      link,
    ),
  ).toThrow("Choose a");
});
it("does not bypass a restricted Packing Slips folder", () => {
  const state = emptyDocumentState();
  const folder = applyDocumentAction(
    state,
    { ...actor, canManage: true },
    { action: "createFolder", name: "Packing Slips" },
  );
  applyDocumentAction(
    state,
    { ...actor, canManage: true },
    {
      action: "setFolderPermissions",
      folderId: folder.id,
      permissions: [{ userId: "receiver", role: "viewer" }],
    },
  );
  expect(() => appendPackingSlip(state, actor, input, link)).toThrow();
  expect(state.documents).toHaveLength(0);
});
