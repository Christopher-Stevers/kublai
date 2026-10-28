// @vitest-environment node
import { expect, it } from "vitest";
import {
  appendPackingSlip,
  appendUnmatchedSlip,
  linkSavedSlip,
  renameLinkedSlip,
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
  expect(appendPackingSlip(state, actor, input, link).documentId).not.toBe(
    first.documentId,
  );
  expect(state.documents).toHaveLength(3);
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
  expect(appendUnmatchedSlip(state, actor, input).documentId).not.toBe(
    saved.documentId,
  );
  // A receiver without document editing may still link the slip they saved.
  const receiver = { ...actor, canWrite: false };
  expect(linkSavedSlip(state, receiver, saved.documentId, link)).toEqual({
    documentId: saved.documentId,
  });
  expect(state.documents).toHaveLength(2);
  expect(doc.packingSlip).toEqual(link);
  expect(doc.name).toBe("Packing slip - PO-123.jpg");
  expect(state.versions.find((v) => v.id === doc.currentVersionId)?.name).toBe(
    doc.name,
  );
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
it("keeps read-only linked copies separate for explicit duplicate review", () => {
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
  expect(
    linkSavedSlip(state, viewer, original.documentId, link).documentId,
  ).not.toBe(copy.documentId);
  expect(state.documents).toHaveLength(3);
});
it("renames an uploaded PDF and its current download, preserving historical versions and file identity", () => {
  const state = emptyDocumentState();
  const pdf = {
    ...input,
    mimeType: "application/pdf",
    name: "delivery-email.pdf",
  };
  const first = appendVersion(state, actor, pdf);
  const latest = appendVersion(state, actor, {
    ...pdf,
    name: "corrected-email.pdf",
    sha256: "b".repeat(64),
    documentId: first.documentId,
    expectedVersionId: first.versionId,
  });
  const versionBefore = { ...state.versions[1]! };
  linkSavedSlip(state, actor, latest.documentId, {
    ...link,
    orderNumber: "162-Next",
  });
  expect(state.documents[0]?.name).toBe("Packing slip - 162-Next.pdf");
  expect(state.versions[1]).toEqual({
    ...versionBefore,
    name: "Packing slip - 162-Next.pdf",
  });
  expect(state.versions[0]?.name).toBe("delivery-email.pdf");
  expect(state.documents[0]?.currentVersionId).toBe(latest.versionId);
  expect(state.versions).toHaveLength(2);
});
it("uses stable scanner suffixes and safe order names when confirming multiple slips", () => {
  const state = emptyDocumentState();
  const unsafeLink = { ...link, orderNumber: "162/Next\\delivery\n" };
  const pdf = { ...input, mimeType: "application/pdf", name: "email.pdf" };
  const scanned = appendPackingSlip(state, actor, pdf, unsafeLink);
  const uploaded = appendVersion(state, actor, {
    ...pdf,
    folderId: state.folders[0]!.id,
  });
  linkSavedSlip(state, actor, uploaded.documentId, unsafeLink);
  const doc = state.documents.find((d) => d.id === uploaded.documentId)!;
  expect(doc.name).toBe("Packing slip - 162-Next-delivery- (2).pdf");
  renameLinkedSlip(state, doc, unsafeLink);
  linkSavedSlip(state, actor, uploaded.documentId, unsafeLink);
  expect(doc.name).toBe("Packing slip - 162-Next-delivery- (2).pdf");
  expect(state.versions.find((v) => v.id === doc.currentVersionId)?.name).toBe(
    doc.name,
  );
  expect(state.documents.find((d) => d.id === scanned.documentId)?.name).toBe(
    "Packing slip - 162-Next-delivery-.pdf",
  );
});
it("repairs a confirmed attachment name on retry without changing a locked document", () => {
  const state = emptyDocumentState();
  const saved = appendPackingSlip(state, actor, input, link);
  const doc = state.documents[0]!;
  doc.name = state.versions[0]!.name = "original-upload.jpg";
  doc.lockedBy = "another-member";
  expect(() => linkSavedSlip(state, actor, saved.documentId, link)).toThrow(
    "locked",
  );
  expect(doc.name).toBe("original-upload.jpg");
  expect(state.versions[0]?.name).toBe("original-upload.jpg");
  doc.lockedBy = null;
  linkSavedSlip(state, actor, saved.documentId, link);
  expect(doc.name).toBe("Packing slip - PO-123.jpg");
  expect(state.versions[0]?.name).toBe(doc.name);
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
