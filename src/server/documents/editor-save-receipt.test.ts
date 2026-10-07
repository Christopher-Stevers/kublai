// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendVersion,
  emptyDocumentState,
  visibleState,
  type DocumentActor,
} from "./domain";
import {
  completeEditorSaveReceipt,
  EDITOR_SAVE_RECEIPT_TTL_MS,
  MAX_EDITOR_SAVE_RECEIPTS,
  readEditorSaveReceipt,
  registerEditorSaveReceipt,
} from "./editor-save-receipt";
import type { DocumentState } from "./types";
const actor: DocumentActor = {
  userId: "writer",
  jobId: randomUUID(),
  canWrite: true,
  canManage: false,
  memberIds: ["writer", "coauthor"],
};
let state: DocumentState;
let documentId: string;
let versionId: string;
let requestId: string;
const now = Date.now();
beforeEach(() => {
  state = emptyDocumentState();
  ({ documentId, versionId } = appendVersion(state, actor, {
    name: "Report.docx",
    mimeType: "application/zip",
    size: 4,
    sha256: "a".repeat(64),
  }));
  requestId = randomUUID();
});
const extended = () => JSON.stringify({ foremanhqSaveRequestId: requestId });
describe("durable editor save receipts", () => {
  it("is pending until a persisted callback completes it and never leaks to overview", () => {
    expect(
      registerEditorSaveReceipt(state, actor, documentId, requestId, now),
    ).toEqual({ requestId, status: "pending" });
    expect(
      readEditorSaveReceipt(state, actor, documentId, requestId, now),
    ).toEqual({ requestId, status: "pending" });
    expect(visibleState(state, actor)).not.toHaveProperty("editorSaveReceipts");
    completeEditorSaveReceipt(
      state,
      actor,
      documentId,
      versionId,
      extended(),
      now + 1,
    );
    const committed = {
      requestId,
      status: "committed",
      versionId,
      committedAt: new Date(now + 1).toISOString(),
    };
    expect(
      readEditorSaveReceipt(state, actor, documentId, requestId, now + 2),
    ).toEqual(committed);
    expect(
      registerEditorSaveReceipt(state, actor, documentId, requestId, now + 2),
    ).toEqual(committed);
    expect(state.editorSaveReceipts).toHaveLength(1);
  });
  it("rejects other owners, documents and jobs, including UUID registration collisions", () => {
    registerEditorSaveReceipt(state, actor, documentId, requestId, now);
    const coauthor = { ...actor, userId: "coauthor" };
    expect(() =>
      readEditorSaveReceipt(state, coauthor, documentId, requestId, now),
    ).toThrow("could not be found");
    expect(() =>
      registerEditorSaveReceipt(state, coauthor, documentId, requestId, now),
    ).toThrow("could not be found");
    const other = appendVersion(state, actor, {
      name: "Other.docx",
      mimeType: "application/zip",
      size: 4,
      sha256: "b".repeat(64),
    });
    expect(() =>
      registerEditorSaveReceipt(state, actor, other.documentId, requestId, now),
    ).toThrow("could not be found");
    expect(() =>
      readEditorSaveReceipt(state, actor, other.documentId, requestId, now),
    ).toThrow("could not be found");
    expect(() =>
      readEditorSaveReceipt(
        state,
        { ...actor, jobId: randomUUID() },
        documentId,
        requestId,
        now,
      ),
    ).toThrow("not found");
    completeEditorSaveReceipt(
      state,
      coauthor,
      other.documentId,
      other.versionId,
      extended(),
      now + 1,
    );
    expect(
      readEditorSaveReceipt(state, actor, documentId, requestId, now).status,
    ).toBe("pending");
  });
  it("permits a signed coauthor retry but keeps the receipt owner private and first commit stable", () => {
    registerEditorSaveReceipt(state, actor, documentId, requestId, now);
    completeEditorSaveReceipt(
      state,
      { ...actor, userId: "coauthor" },
      documentId,
      versionId,
      extended(),
      now + 1,
    );
    expect(state.editorSaveReceipts![0]).toMatchObject({
      userId: "writer",
      savedBy: "coauthor",
      versionId,
    });
    completeEditorSaveReceipt(
      state,
      actor,
      documentId,
      randomUUID(),
      extended(),
      now + 2,
    );
    expect(
      readEditorSaveReceipt(state, actor, documentId, requestId, now + 3)
        .versionId,
    ).toBe(versionId);
  });
  it("does not acknowledge missing, invalid, unknown or expired metadata", () => {
    registerEditorSaveReceipt(state, actor, documentId, requestId, now);
    for (const metadata of [
      undefined,
      null,
      "",
      "undefined",
      "{",
      "a".repeat(513),
      JSON.stringify({ foremanhqSaveRequestId: randomUUID() }),
      JSON.stringify({ foremanhqSaveRequestId: requestId, other: 1 }),
    ]) {
      completeEditorSaveReceipt(
        state,
        actor,
        documentId,
        versionId,
        metadata,
        now + 1,
      );
      expect(state.editorSaveReceipts![0]!.committedAt).toBeUndefined();
    }
    completeEditorSaveReceipt(
      state,
      actor,
      documentId,
      versionId,
      extended(),
      now + EDITOR_SAVE_RECEIPT_TTL_MS,
    );
    expect(state.editorSaveReceipts![0]!.committedAt).toBeUndefined();
    expect(() =>
      readEditorSaveReceipt(
        state,
        actor,
        documentId,
        requestId,
        now + EDITOR_SAVE_RECEIPT_TTL_MS,
      ),
    ).toThrow("expired");
    expect(() =>
      registerEditorSaveReceipt(
        state,
        actor,
        documentId,
        requestId,
        now + EDITOR_SAVE_RECEIPT_TTL_MS,
      ),
    ).toThrow("expired");
  });
  it("rejects viewers, other-member locks and revoked folder/recycle access", () => {
    expect(() =>
      registerEditorSaveReceipt(
        state,
        { ...actor, canWrite: false },
        documentId,
        requestId,
        now,
      ),
    ).toThrow("permission");
    state.documents[0]!.lockedBy = "coauthor";
    expect(() =>
      registerEditorSaveReceipt(state, actor, documentId, requestId, now),
    ).toThrow("locked");
    state.documents[0]!.lockedBy = null;
    registerEditorSaveReceipt(state, actor, documentId, requestId, now);
    state.documents[0]!.deletedAt = new Date(now).toISOString();
    expect(() =>
      readEditorSaveReceipt(state, actor, documentId, requestId, now),
    ).toThrow("not found");
    state.documents[0]!.deletedAt = null;
    const folderId = randomUUID();
    state.folders.push({
      id: folderId,
      parentId: null,
      name: "Private",
      permissions: [{ userId: "coauthor", role: "manager" }],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      createdBy: "coauthor",
    });
    state.documents[0]!.folderId = folderId;
    expect(() =>
      readEditorSaveReceipt(state, actor, documentId, requestId, now),
    ).toThrow("not found");
  });
  it("bounds live records, preserves pending requests, and reclaims expired slots", () => {
    for (let count = 0; count < MAX_EDITOR_SAVE_RECEIPTS; count++)
      registerEditorSaveReceipt(state, actor, documentId, randomUUID(), now);
    expect(() =>
      registerEditorSaveReceipt(state, actor, documentId, requestId, now),
    ).toThrow("Too many");
    expect(state.editorSaveReceipts).toHaveLength(MAX_EDITOR_SAVE_RECEIPTS);
    expect(
      registerEditorSaveReceipt(
        state,
        actor,
        documentId,
        requestId,
        now + EDITOR_SAVE_RECEIPT_TTL_MS,
      ).status,
    ).toBe("pending");
    expect(state.editorSaveReceipts).toHaveLength(1);
  });
});
