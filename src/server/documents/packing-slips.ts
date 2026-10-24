import { TRPCError } from "@trpc/server";
import {
  accessibleDocument,
  assertStateBounds,
  appendVersion,
  applyDocumentAction,
  folderRole,
  type DocumentActor,
} from "./domain";
import type { DocumentState, PackingSlipLink } from "./types";
const SLIP_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];
const EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
/** Name given to scans saved before their order is known. */
export const UNMATCHED_SLIP = "Packing slip - unmatched";
const findSlipFolder = (state: DocumentState) =>
  state.folders.find(
    (f) =>
      f.parentId === null && f.name.trim().toLowerCase() === "packing slips",
  );
function slipFolder(state: DocumentState, actor: DocumentActor) {
  return (
    findSlipFolder(state)?.id ??
    applyDocumentAction(state, actor, {
      action: "createFolder",
      name: "Packing Slips",
      parentId: null,
    }).id
  );
}
function freeName(
  state: DocumentState,
  folderId: string | null,
  base: string,
  mimeType: string,
  self?: string,
) {
  let number = 1,
    name = `${base}.${EXTENSION[mimeType]}`;
  while (
    state.documents.some(
      (d) =>
        d.id !== self &&
        !d.deletedAt &&
        d.folderId === folderId &&
        d.name.toLowerCase() === name.toLowerCase(),
    )
  )
    name = `${base} (${++number}).${EXTENSION[mimeType]}`;
  return name;
}
const orderBase = (link: PackingSlipLink) =>
  `Packing slip - ${link.orderNumber.replace(/[\\/\x00-\x1f\x7f]/g, "-").slice(0, 100)}`;
function assertNewSlip(input: Parameters<typeof appendVersion>[2]) {
  if (
    input.documentId ||
    input.folderId ||
    input.expectedVersionId ||
    input.submittal
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Packing slips must be new attachments.",
    });
  if (!SLIP_TYPES.includes(input.mimeType))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a JPEG, PNG, WebP photo or PDF packing slip.",
    });
}
const linkedCopy = (state: DocumentState, orderId: string, sha256: string) =>
  state.documents.find(
    (d) =>
      !d.deletedAt &&
      d.packingSlip?.orderId === orderId &&
      state.versions.some(
        (v) => v.id === d.currentVersionId && v.sha256 === sha256,
      ),
  );
/** Called with a transaction-verified order/list association. */
export function appendPackingSlip(
  state: DocumentState,
  actor: DocumentActor,
  input: Parameters<typeof appendVersion>[2],
  link: PackingSlipLink,
) {
  assertNewSlip(input);
  const duplicate = linkedCopy(state, link.orderId, input.sha256);
  if (duplicate) {
    accessibleDocument(state, actor, duplicate.id, { write: true });
    return { documentId: duplicate.id, versionId: duplicate.currentVersionId! };
  }
  const folderId = slipFolder(state, actor);
  const name = freeName(state, folderId, orderBase(link), input.mimeType);
  const result = appendVersion(state, actor, { ...input, name, folderId });
  const doc = state.documents.find((d) => d.id === result.documentId)!;
  doc.packingSlip = link;
  doc.description = `Packing slip for ${link.orderNumber} · ${link.materialListName}`;
  doc.tags = ["Packing slip"];
  assertStateBounds(state);
  return result;
}
/** A scanned slip kept in Packing Slips until its order is chosen. The same
 * file saved before is reused. */
export function appendUnmatchedSlip(
  state: DocumentState,
  actor: DocumentActor,
  input: Parameters<typeof appendVersion>[2],
) {
  assertNewSlip(input);
  const folder = findSlipFolder(state);
  const saved = state.documents.find(
    (d) =>
      !d.deletedAt &&
      d.jobId === actor.jobId &&
      (Boolean(d.packingSlip) || d.folderId === folder?.id) &&
      state.versions.some(
        (v) => v.id === d.currentVersionId && v.sha256 === input.sha256,
      ),
  );
  if (saved) {
    accessibleDocument(state, actor, saved.id);
    return { documentId: saved.id, versionId: saved.currentVersionId! };
  }
  const folderId = slipFolder(state, actor);
  const name = freeName(
    state,
    folderId,
    `${UNMATCHED_SLIP} ${new Date().toISOString().slice(0, 10)}`,
    input.mimeType,
  );
  const result = appendVersion(state, actor, { ...input, name, folderId });
  const doc = state.documents.find((d) => d.id === result.documentId)!;
  doc.description = "Packing slip not yet matched to an order";
  doc.tags = ["Packing slip"];
  assertStateBounds(state);
  return result;
}
/** Links a saved slip to a transaction-verified order. Slips in Packing
 * Slips, or that the member may edit, are linked in place; others get a
 * linked copy of the same file. */
export function linkSavedSlip(
  state: DocumentState,
  actor: DocumentActor,
  documentId: string,
  link: PackingSlipLink,
) {
  const doc = accessibleDocument(state, actor, documentId);
  if (doc.packingSlip) {
    if (doc.packingSlip.orderId === link.orderId) return { documentId: doc.id };
    throw new TRPCError({
      code: "CONFLICT",
      message: `This packing slip is already attached to ${doc.packingSlip.orderNumber}.`,
    });
  }
  const version = state.versions.find((v) => v.id === doc.currentVersionId);
  if (!version || !SLIP_TYPES.includes(version.mimeType))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a JPEG, PNG, WebP photo or PDF packing slip.",
    });
  const duplicate = linkedCopy(state, link.orderId, version.sha256);
  if (duplicate) {
    accessibleDocument(state, actor, duplicate.id);
    return { documentId: duplicate.id };
  }
  // Receiving grants editing slips in Packing Slips, unless that folder is
  // restricted for the member.
  const inPlace =
    (doc.folderId === (findSlipFolder(state)?.id ?? "") &&
      folderRole(state, { ...actor, canWrite: true }, doc.folderId) !==
        "viewer") ||
    folderRole(state, actor, doc.folderId) !== "viewer";
  if (!inPlace)
    return appendPackingSlip(
      state,
      { ...actor, canWrite: true },
      {
        name: doc.name,
        size: version.size,
        mimeType: version.mimeType,
        sha256: version.sha256,
      },
      link,
    );
  if (doc.lockedBy && doc.lockedBy !== actor.userId)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Document is locked by another member.",
    });
  if (doc.name.startsWith(UNMATCHED_SLIP))
    doc.name = freeName(
      state,
      doc.folderId,
      orderBase(link),
      version.mimeType,
      doc.id,
    );
  doc.packingSlip = link;
  doc.description = `Packing slip for ${link.orderNumber} · ${link.materialListName}`;
  doc.tags = [...new Set([...doc.tags, "Packing slip"])];
  doc.updatedAt = new Date().toISOString();
  assertStateBounds(state);
  return { documentId: doc.id };
}
