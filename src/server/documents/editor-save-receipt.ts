import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  accessibleDocument,
  assertStateBounds,
  type DocumentActor,
} from "./domain";
import type {
  DocumentEditorSaveReceipt,
  DocumentEditorSaveStatus,
  DocumentState,
} from "./types";

export const EDITOR_SAVE_RECEIPT_TTL_MS = 15 * 60 * 1000;
export const MAX_EDITOR_SAVE_RECEIPTS = 256;
const requestIdSchema = z.uuid();
const extendedDataSchema = z
  .object({ foremanhqSaveRequestId: requestIdSchema })
  .strict();
function statusOf(
  receipt: DocumentEditorSaveReceipt,
): DocumentEditorSaveStatus {
  return receipt.versionId && receipt.committedAt
    ? {
        requestId: receipt.requestId,
        status: "committed",
        versionId: receipt.versionId,
        committedAt: receipt.committedAt,
      }
    : { requestId: receipt.requestId, status: "pending" };
}
function missingReceipt(): never {
  throw new TRPCError({
    code: "NOT_FOUND",
    message:
      "This save confirmation expired or could not be found. Save again while keeping the editor open.",
  });
}
export function registerEditorSaveReceipt(
  state: DocumentState,
  actor: DocumentActor,
  documentId: string,
  requestId: string,
  now = Date.now(),
): DocumentEditorSaveStatus {
  requestIdSchema.parse(requestId);
  accessibleDocument(state, actor, documentId, { write: true });
  const existing = state.editorSaveReceipts?.find(
    (entry) => entry.requestId === requestId,
  );
  if (existing) {
    if (
      existing.userId !== actor.userId ||
      existing.documentId !== documentId ||
      Date.parse(existing.expiresAt) <= now
    )
      missingReceipt();
    return statusOf(existing);
  }
  const receipts = (state.editorSaveReceipts ?? []).filter(
    (entry) => Date.parse(entry.expiresAt) > now,
  );
  if (receipts.length >= MAX_EDITOR_SAVE_RECEIPTS)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        "Too many recent save confirmations. Keep the editor open and try again shortly.",
    });
  const receipt = {
    requestId,
    documentId,
    userId: actor.userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EDITOR_SAVE_RECEIPT_TTL_MS).toISOString(),
  };
  state.editorSaveReceipts = [...receipts, receipt];
  assertStateBounds(state);
  return statusOf(receipt);
}
export function readEditorSaveReceipt(
  state: DocumentState,
  actor: DocumentActor,
  documentId: string,
  requestId: string,
  now = Date.now(),
): DocumentEditorSaveStatus {
  accessibleDocument(state, actor, documentId);
  const receipt = state.editorSaveReceipts?.find(
    (entry) =>
      entry.requestId === requestId &&
      entry.documentId === documentId &&
      entry.userId === actor.userId &&
      Date.parse(entry.expiresAt) > now,
  );
  if (!receipt) missingReceipt();
  return statusOf(receipt);
}
/** Only call after an authorized, timestamp-checked PutFile has persisted its blob,
 * inside the same transaction that publishes the version. Core acknowledgments
 * cannot complete a receipt. Missing/stale metadata must never block autosaves. */
export function completeEditorSaveReceipt(
  state: DocumentState,
  actor: DocumentActor,
  documentId: string,
  versionId: string,
  extendedData: string | null | undefined,
  now = Date.now(),
) {
  if (!extendedData || extendedData.length > 512) return;
  let requestId: string;
  try {
    requestId = extendedDataSchema.parse(
      JSON.parse(extendedData),
    ).foremanhqSaveRequestId;
  } catch {
    return;
  }
  const receipt = state.editorSaveReceipts?.find(
    (entry) =>
      entry.requestId === requestId &&
      entry.documentId === documentId &&
      Date.parse(entry.expiresAt) > now,
  );
  if (!receipt || receipt.committedAt) return;
  // A Collabora retry may use another currently authorized coauthor's token.
  // The unguessable registered request and file bind the confirmation; its
  // requester remains the only member who can read the receipt.
  receipt.versionId = versionId;
  receipt.committedAt = new Date(now).toISOString();
  receipt.savedBy = actor.userId;
  assertStateBounds(state);
}
