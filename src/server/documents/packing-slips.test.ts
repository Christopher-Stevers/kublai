// @vitest-environment node
import { expect, it } from "vitest";
import {
  appendPackingSlip,
  appendUnmatchedSlip,
  linkSavedSlip,
} from "./packing-slips";
import {
  emptyDocumentState,
  applyDocumentAction,
  appendVersion,
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
it("keeps an unmatched scan in Packing Slips and links it in place to the chosen order", () => {
  const state = emptyDocumentState();
  const saved = appendUnmatchedSlip(state, actor, input);
  const doc = state.documents[0]!;
  expect(doc.name).toMatch(/^Packing slip - unmatched \d{4}-\d{2}-\d{2}\.jpg$/);
  expect(doc.packingSlip).toBeUndefined();
  expect(appendUnmatchedSlip(state, actor, input)).toEqual(saved);
  // A receiver without document editing may still link the slip they saved.
  const receiver = { ...actor, canWrite: false };
  expect(linkSavedSlip(state, receiver, saved.documentId, link)).toEqual({
    documentId: saved.documentId,
  });
  expect(state.documents).toHaveLength(1);
  expect(doc.packingSlip).toEqual(link);
  expect(doc.name).not.toContain("unmatched");
  expect(doc.tags).toEqual(["Packing slip"]);
  expect(linkSavedSlip(state, receiver, saved.documentId, link)).toEqual({
    documentId: saved.documentId,
  });
  expect(() =>
    linkSavedSlip(state, receiver, saved.documentId, {
      ...link,
      orderId: "other",
      orderNumber: "PO-9",
    }),
  ).toThrow("already attached to PO-123");
});
it("links a read-only slip from another folder as a copy and reuses an earlier copy", () => {
  const state = emptyDocumentState();
  const other = applyDocumentAction(
    state,
    { ...actor, canManage: true },
    { action: "createFolder", name: "Site photos" },
  );
  const original = appendVersion(
    state,
    { ...actor, canManage: true },
    { ...input, name: "slip.jpg", folderId: other.id },
  );
  const viewer = { ...actor, canWrite: false };
  const copy = linkSavedSlip(state, viewer, original.documentId, link);
  expect(copy.documentId).not.toBe(original.documentId);
  expect(state.documents).toHaveLength(2);
  expect(
    state.documents.find((d) => d.id === original.documentId)?.packingSlip,
  ).toBeUndefined();
  expect(
    state.documents.find((d) => d.id === copy.documentId)?.packingSlip,
  ).toEqual(link);
  expect(linkSavedSlip(state, viewer, original.documentId, link)).toEqual({
    documentId: copy.documentId,
  });
  expect(state.documents).toHaveLength(2);
});
it("does not link in place in a Packing Slips folder restricted to viewing", () => {
  const state = emptyDocumentState();
  const saved = appendUnmatchedSlip(state, actor, input);
  applyDocumentAction(
    state,
    { ...actor, canManage: true },
    {
      action: "setFolderPermissions",
      folderId: state.folders[0]!.id,
      permissions: [{ userId: "receiver", role: "viewer" }],
    },
  );
  expect(() => linkSavedSlip(state, actor, saved.documentId, link)).toThrow();
  expect(state.documents[0]?.packingSlip).toBeUndefined();
});
