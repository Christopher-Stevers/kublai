// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  accessibleDocument,
  appendVersion,
  applyDocumentAction,
  assertFolderRole,
  assertStateBounds,
  emptyDocumentState,
  folderRole,
  visibleState,
  type DocumentActor,
} from "./domain";
import { documentActionSchema } from "./contracts";
import type { DocumentState } from "./types";

const owner: DocumentActor = {
  userId: "owner",
  jobId: randomUUID(),
  canWrite: true,
  canManage: true,
  memberIds: ["owner", "editor", "reader", "reviewer"],
};
const editor: DocumentActor = { ...owner, userId: "editor", canManage: false };
const reader: DocumentActor = {
  ...owner,
  userId: "reader",
  canManage: false,
  canWrite: false,
};
const reviewer: DocumentActor = { ...reader, userId: "reviewer" };
const file = {
  name: "Schedule.xlsx",
  mimeType: "application/octet-stream",
  size: 24,
  sha256: "a".repeat(64),
};
function uploaded(state: DocumentState, folderId?: string | null) {
  return appendVersion(state, owner, { ...file, folderId });
}
function folder(
  state: DocumentState,
  name = "Plans",
  parentId?: string | null,
) {
  return applyDocumentAction(state, owner, {
    action: "createFolder",
    name,
    parentId,
  }).id;
}
function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error("Expected failure");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("Document authorization and folder hierarchy", () => {
  it("permits root viewing but does not let an ACL elevate an org read-only member", () => {
    const state = emptyDocumentState();
    const id = folder(state);
    applyDocumentAction(state, owner, {
      action: "setFolderPermissions",
      folderId: id,
      permissions: [{ userId: reader.userId, role: "manager" }],
    });
    expect(folderRole(state, reader, id)).toBe("viewer");
    expectCode(
      () => assertFolderRole(state, reader, id, "editor"),
      "FORBIDDEN",
    );
    expectCode(
      () => appendVersion(state, reader, { ...file, folderId: id }),
      "FORBIDDEN",
    );
  });
  it("inherits permissions and prevents metadata/version/comment leaks from hidden folders", () => {
    const state = emptyDocumentState();
    const parent = folder(state);
    const child = folder(state, "Restricted", parent);
    const doc = uploaded(state, child);
    applyDocumentAction(state, owner, {
      action: "comment",
      documentId: doc.documentId,
      body: "private",
    });
    applyDocumentAction(state, owner, {
      action: "setFolderPermissions",
      folderId: parent,
      permissions: [{ userId: "owner", role: "manager" }],
    });
    expect(folderRole(state, editor, child)).toBeNull();
    expectCode(
      () => accessibleDocument(state, editor, doc.documentId),
      "NOT_FOUND",
    );
    const view = visibleState(state, editor);
    expect(view.folders).toEqual([]);
    expect(view.documents).toEqual([]);
    expect(view.versions).toEqual([]);
    expect(view.comments).toEqual([]);
    expect(view.activity).toEqual([]);
  });
  it("redacts denied ancestor paths for an explicitly permitted child", () => {
    const state = emptyDocumentState();
    const parent = folder(state, "Secret client");
    const child = folder(state, "Shared", parent);
    applyDocumentAction(state, owner, {
      action: "setFolderPermissions",
      folderId: parent,
      permissions: [{ userId: "owner", role: "manager" }],
    });
    applyDocumentAction(state, owner, {
      action: "setFolderPermissions",
      folderId: child,
      permissions: [{ userId: "reader", role: "viewer" }],
    });
    expect(visibleState(state, reader).folders).toMatchObject([
      { id: child, parentId: null, permissions: [] },
    ]);
    expect(state.folders.find((entry) => entry.id === child)?.parentId).toBe(
      parent,
    );
  });
  it("cannot read a different job document even if supplied contaminated state", () => {
    const state = emptyDocumentState();
    const doc = uploaded(state);
    expectCode(
      () =>
        accessibleDocument(
          state,
          { ...owner, jobId: randomUUID() },
          doc.documentId,
        ),
      "NOT_FOUND",
    );
    expect(
      visibleState(state, { ...owner, jobId: randomUUID() }).documents,
    ).toEqual([]);
  });
  it("rejects ACL grants to outside members and duplicate members", () => {
    const state = emptyDocumentState();
    const id = folder(state);
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "setFolderPermissions",
          folderId: id,
          permissions: [{ userId: "foreign", role: "viewer" }],
        }),
      "BAD_REQUEST",
    );
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "setFolderPermissions",
          folderId: id,
          permissions: [
            { userId: "editor", role: "viewer" },
            { userId: "editor", role: "manager" },
          ],
        }),
      "BAD_REQUEST",
    );
    expectCode(
      () =>
        applyDocumentAction(state, editor, {
          action: "setFolderPermissions",
          folderId: id,
          permissions: [],
        }),
      "FORBIDDEN",
    );
  });
  it("prevents cycles, depth overflow and moving restricted subtrees without permission", () => {
    const state = emptyDocumentState();
    const parent = folder(state);
    const child = folder(state, "Child", parent);
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "updateFolder",
          folderId: parent,
          parentId: child,
        }),
      "BAD_REQUEST",
    );
    expectCode(
      () =>
        applyDocumentAction(state, editor, {
          action: "updateFolder",
          folderId: parent,
          name: "Changed",
        }),
      "FORBIDDEN",
    );
    let ancestor = child;
    for (let i = 2; i < 50; i++)
      ancestor = folder(state, `Nested ${i}`, ancestor);
    expectCode(() => folder(state, "Too deep", ancestor), "BAD_REQUEST");
  });
});

describe("Immutable document lifecycle", () => {
  it("requires the current version to append and preserves history", () => {
    const state = emptyDocumentState();
    const first = uploaded(state);
    expectCode(
      () =>
        appendVersion(state, owner, { ...file, documentId: first.documentId }),
      "CONFLICT",
    );
    const second = appendVersion(state, owner, {
      ...file,
      documentId: first.documentId,
      expectedVersionId: first.versionId,
      sha256: "b".repeat(64),
    });
    expectCode(
      () =>
        appendVersion(state, owner, {
          ...file,
          documentId: first.documentId,
          expectedVersionId: first.versionId,
        }),
      "CONFLICT",
    );
    applyDocumentAction(state, owner, {
      action: "restoreVersion",
      documentId: first.documentId,
      versionId: first.versionId,
    });
    expect(
      state.versions.map((version) => [version.number, version.sha256]),
    ).toEqual([
      [1, "a".repeat(64)],
      [2, "b".repeat(64)],
      [3, "a".repeat(64)],
    ]);
    expect(state.documents[0]?.currentVersionId).not.toBe(first.versionId);
    expect(state.documents[0]?.currentVersionId).not.toBe(second.versionId);
  });
  it("does not restore another document's version", () => {
    const state = emptyDocumentState();
    const first = uploaded(state);
    const second = appendVersion(state, owner, { ...file, name: "Other.pdf" });
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "restoreVersion",
          documentId: first.documentId,
          versionId: second.versionId,
        }),
      "NOT_FOUND",
    );
  });
  it("respects locks, permits manager unlock and blocks simultaneous writers", () => {
    const state = emptyDocumentState();
    const doc = uploaded(state);
    applyDocumentAction(state, editor, {
      action: "lock",
      documentId: doc.documentId,
    });
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "delete",
          documentId: doc.documentId,
        }),
      "CONFLICT",
    );
    expectCode(
      () =>
        appendVersion(state, owner, {
          ...file,
          documentId: doc.documentId,
          expectedVersionId: doc.versionId,
        }),
      "CONFLICT",
    );
    expectCode(
      () =>
        applyDocumentAction(
          state,
          { ...editor, userId: "other-editor" },
          { action: "unlock", documentId: doc.documentId },
        ),
      "FORBIDDEN",
    );
    applyDocumentAction(state, owner, {
      action: "unlock",
      documentId: doc.documentId,
    });
    expect(state.documents[0]?.lockedBy).toBeNull();
  });
  it("hides recycled files from readers and never serves their bytes until restored", () => {
    const state = emptyDocumentState();
    const doc = uploaded(state);
    applyDocumentAction(state, owner, {
      action: "delete",
      documentId: doc.documentId,
    });
    expectCode(
      () => accessibleDocument(state, owner, doc.documentId),
      "NOT_FOUND",
    );
    expectCode(
      () =>
        accessibleDocument(state, reader, doc.documentId, {
          allowDeleted: true,
        }),
      "NOT_FOUND",
    );
    expect(visibleState(state, reader).documents).toEqual([]);
    expect(visibleState(state, owner).documents).toHaveLength(1);
    applyDocumentAction(state, owner, {
      action: "restore",
      documentId: doc.documentId,
    });
    expect(
      accessibleDocument(state, reader, doc.documentId).deletedAt,
    ).toBeNull();
  });
  it("rejects sibling name collisions when uploading, moving and restoring", () => {
    const state = emptyDocumentState();
    const doc = uploaded(state);
    const target = folder(state);
    expectCode(
      () => appendVersion(state, owner, { ...file, name: "schedule.XLSX" }),
      "CONFLICT",
    );
    const second = uploaded(state, target);
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "updateDocument",
          documentId: second.documentId,
          folderId: null,
        }),
      "CONFLICT",
    );
    applyDocumentAction(state, owner, {
      action: "delete",
      documentId: doc.documentId,
    });
    uploaded(state);
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "restore",
          documentId: doc.documentId,
        }),
      "CONFLICT",
    );
  });
  it("copies a folder document explicitly to root with a new version identity", () => {
    const state = emptyDocumentState();
    const target = folder(state);
    const doc = uploaded(state, target);
    const copy = applyDocumentAction(state, owner, {
      action: "copy",
      documentId: doc.documentId,
      folderId: null,
    });
    expect(state.documents.find((entry) => entry.id === copy.id)).toMatchObject(
      { folderId: null, name: "Schedule (copy).xlsx" },
    );
    expect(
      state.versions.find((entry) => entry.documentId === copy.id),
    ).toMatchObject({
      number: 1,
      sha256: file.sha256,
      restoredFromVersionId: doc.versionId,
    });
  });
  it("allows readers to comment but not change metadata", () => {
    const state = emptyDocumentState();
    const doc = uploaded(state);
    applyDocumentAction(state, reader, {
      action: "comment",
      documentId: doc.documentId,
      body: "Check this dimension.",
    });
    expect(state.comments).toMatchObject([{ createdBy: "reader" }]);
    expectCode(
      () =>
        applyDocumentAction(state, reader, {
          action: "updateDocument",
          documentId: doc.documentId,
          description: "Overwrite",
        }),
      "FORBIDDEN",
    );
  });
});

describe("Review and transmittal records", () => {
  it("allows only the assigned reviewer to decide and rejects a second decision", () => {
    const state = emptyDocumentState();
    const doc = uploaded(state);
    const review = applyDocumentAction(state, owner, {
      action: "createReview",
      title: "Ready for issue",
      documentIds: [doc.documentId],
      reviewerId: "reviewer",
    });
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "resolveReview",
          reviewId: review.id,
          decision: "approved",
        }),
      "FORBIDDEN",
    );
    applyDocumentAction(state, reviewer, {
      action: "resolveReview",
      reviewId: review.id,
      decision: "approved",
    });
    expect(state.documents[0]?.status).toBe("approved");
    expectCode(
      () =>
        applyDocumentAction(state, reviewer, {
          action: "resolveReview",
          reviewId: review.id,
          decision: "changes_requested",
        }),
      "CONFLICT",
    );
  });
  it("blocks duplicate pending reviews, supersedes stale snapshots and prevents direct approval", () => {
    const state = emptyDocumentState();
    const doc = uploaded(state);
    const action = {
      action: "createReview" as const,
      title: "Review",
      documentIds: [doc.documentId],
      reviewerId: "reviewer",
    };
    const review = applyDocumentAction(state, owner, action);
    expectCode(() => applyDocumentAction(state, owner, action), "CONFLICT");
    appendVersion(state, owner, {
      ...file,
      documentId: doc.documentId,
      expectedVersionId: doc.versionId,
    });
    expect(state.reviews[0]?.status).toBe("superseded");
    expectCode(
      () =>
        applyDocumentAction(state, reviewer, {
          action: "resolveReview",
          reviewId: review.id,
          decision: "approved",
        }),
      "CONFLICT",
    );
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "updateDocument",
          documentId: doc.documentId,
          status: "approved",
        }),
      "BAD_REQUEST",
    );
  });
  it("does not invite reviewers without folder access or review live links", () => {
    const state = emptyDocumentState();
    const id = folder(state);
    const doc = uploaded(state, id);
    applyDocumentAction(state, owner, {
      action: "setFolderPermissions",
      folderId: id,
      permissions: [{ userId: "owner", role: "manager" }],
    });
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "createReview",
          title: "Private",
          documentIds: [doc.documentId],
          reviewerId: "reviewer",
        }),
      "BAD_REQUEST",
    );
    const linked = applyDocumentAction(state, owner, {
      action: "linkOffice",
      name: "Cloud.docx",
      webUrl: "https://example.sharepoint.com/Shared%20Documents/Cloud.docx",
    });
    expectCode(
      () =>
        applyDocumentAction(state, owner, {
          action: "createReview",
          title: "Cloud",
          documentIds: [linked.id],
          reviewerId: "reviewer",
        }),
      "BAD_REQUEST",
    );
  });
  it("preserves the exact transmitted version after rename and later upload", () => {
    const state = emptyDocumentState();
    const doc = uploaded(state);
    applyDocumentAction(state, owner, {
      action: "createTransmittal",
      title: "Issued",
      documentIds: [doc.documentId],
      recipients: ["reviewer@example.com"],
      message: "For information",
    });
    appendVersion(state, owner, {
      ...file,
      documentId: doc.documentId,
      expectedVersionId: doc.versionId,
    });
    applyDocumentAction(state, owner, {
      action: "updateDocument",
      documentId: doc.documentId,
      name: "Revised.xlsx",
    });
    expect(state.transmittals[0]?.documents).toEqual([
      {
        documentId: doc.documentId,
        versionId: doc.versionId,
        name: "Schedule.xlsx",
        officeWebUrl: null,
      },
    ]);
  });
  it("removes whole review/transmittal metadata when a referenced document becomes hidden", () => {
    const state = emptyDocumentState();
    const id = folder(state);
    const doc = uploaded(state, id);
    applyDocumentAction(state, owner, {
      action: "createReview",
      title: "Private project name",
      documentIds: [doc.documentId],
      reviewerId: "reviewer",
    });
    applyDocumentAction(state, owner, {
      action: "createTransmittal",
      title: "Private transmittal",
      documentIds: [doc.documentId],
      recipients: ["a@example.com"],
    });
    applyDocumentAction(state, owner, {
      action: "setFolderPermissions",
      folderId: id,
      permissions: [{ userId: "owner", role: "manager" }],
    });
    expect(visibleState(state, reader).reviews).toEqual([]);
    expect(visibleState(state, reader).transmittals).toEqual([]);
  });
});

describe("Bounded inputs", () => {
  it("rejects path/control names and overlarge comments/selection", () => {
    expect(
      documentActionSchema.safeParse({
        action: "createFolder",
        name: "../secret",
      }).success,
    ).toBe(false);
    expect(
      documentActionSchema.safeParse({
        action: "comment",
        documentId: randomUUID(),
        body: "a".repeat(10001),
      }).success,
    ).toBe(false);
    expect(
      documentActionSchema.safeParse({
        action: "createTransmittal",
        title: "Bulk",
        documentIds: Array.from({ length: 101 }, () => randomUUID()),
        recipients: ["user@example.com"],
      }).success,
    ).toBe(false);
  });
  it("refuses a workspace beyond the document bound", () => {
    const state = emptyDocumentState();
    uploaded(state);
    state.documents = Array.from({ length: 2001 }, () => ({
      ...state.documents[0]!,
      id: randomUUID(),
    }));
    expectCode(() => assertStateBounds(state), "PAYLOAD_TOO_LARGE");
  });
});
