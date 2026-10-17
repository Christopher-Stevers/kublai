import { TRPCError } from "@trpc/server";
import {
  accessibleDocument,
  assertStateBounds,
  appendVersion,
  applyDocumentAction,
  type DocumentActor,
} from "./domain";
import type { DocumentState, PackingSlipLink } from "./types";
/** Called with a transaction-verified order/list association. */
export function appendPackingSlip(
  state: DocumentState,
  actor: DocumentActor,
  input: Parameters<typeof appendVersion>[2],
  link: PackingSlipLink,
) {
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
  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
    ].includes(input.mimeType)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a JPEG, PNG, WebP photo or PDF packing slip.",
    });
  const duplicate = state.documents.find(
    (d) =>
      !d.deletedAt &&
      d.packingSlip?.orderId === link.orderId &&
      state.versions.some(
        (v) => v.id === d.currentVersionId && v.sha256 === input.sha256,
      ),
  );
  if (duplicate) {
    accessibleDocument(state, actor, duplicate.id, { write: true });
    return { documentId: duplicate.id, versionId: duplicate.currentVersionId! };
  }
  const folder = state.folders.find(
    (f) =>
      f.parentId === null && f.name.trim().toLowerCase() === "packing slips",
  );
  const folderId =
    folder?.id ??
    applyDocumentAction(state, actor, {
      action: "createFolder",
      name: "Packing Slips",
      parentId: null,
    }).id;
  const extension: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const base = `Packing slip - ${link.orderNumber.replace(/[\\/\x00-\x1f\x7f]/g, "-").slice(0, 100)}`;
  let number = 1,
    name = `${base}.${extension[input.mimeType]}`;
  while (
    state.documents.some(
      (d) =>
        !d.deletedAt &&
        d.folderId === folderId &&
        d.name.toLowerCase() === name.toLowerCase(),
    )
  )
    name = `${base} (${++number}).${extension[input.mimeType]}`;
  const result = appendVersion(state, actor, { ...input, name, folderId });
  const doc = state.documents.find((d) => d.id === result.documentId)!;
  doc.packingSlip = link;
  doc.description = `Packing slip for ${link.orderNumber} · ${link.materialListName}`;
  doc.tags = ["Packing slip"];
  assertStateBounds(state);
  return result;
}
