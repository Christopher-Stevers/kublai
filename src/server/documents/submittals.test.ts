// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  appendVersion,
  applyDocumentAction,
  emptyDocumentState,
  visibleState,
  type DocumentActor,
} from "./domain";
import {
  submittalInputSchema,
  parseSubmittalUpload,
  documentActionSchema,
} from "./contracts";
import {
  defaultSubmittal,
  needsSubmittalReview,
  submittalRegister,
  submittalOverdue,
  submittalStatus,
} from "~/lib/submittals";
import type { DocumentOverview, DocumentState } from "./types";
const actor: DocumentActor = {
  userId: "editor",
  jobId: randomUUID(),
  canManage: true,
  canWrite: true,
  memberIds: ["editor", "reviewer"],
};
const reviewer: DocumentActor = {
  ...actor,
  userId: "reviewer",
  canWrite: false,
  canManage: false,
};
const file = {
  name: "Product_data.pdf",
  mimeType: "application/pdf",
  size: 100,
  sha256: "a".repeat(64),
};
function upload(state: DocumentState) {
  return appendVersion(state, actor, {
    ...file,
    submittal: defaultSubmittal(file.name),
  });
}
function request(state: DocumentState, documentId: string) {
  return applyDocumentAction(state, actor, {
    action: "createReview",
    documentIds: [documentId],
    title: "Approval",
    reviewerId: reviewer.userId,
  }).id;
}
function overview(state: DocumentState, user = actor): DocumentOverview {
  return {
    ...visibleState(state, user),
    capabilities: {
      canManage: user.canManage,
      canWrite: user.canWrite,
      userId: user.userId,
    },
    members: [],
    office: { mode: "linked", embeddedConfigured: false },
  };
}

describe("Submittal lifecycle and isolation", () => {
  it("accepts old workspaces and assigns unique references even for identical names and recycled PDFs", () => {
    const state = emptyDocumentState();
    appendVersion(state, actor, { ...file, name: "Ordinary.pdf" });
    const first = upload(state);
    applyDocumentAction(state, actor, {
      action: "delete",
      documentId: first.documentId,
    });
    upload(state);
    expect(state.documents.map((doc) => doc.submittal?.number)).toEqual([
      undefined,
      "SUB-001",
      "SUB-002",
    ]);
    expect(state.documents[1]?.submittal?.title).toBe("Product data");
  });
  it("refuses fake PDF uploads and non-PDF replacements before mutating state", () => {
    const state = emptyDocumentState();
    expect(() =>
      appendVersion(state, actor, {
        ...file,
        mimeType: "application/octet-stream",
        submittal: defaultSubmittal(file.name),
      }),
    ).toThrow("must be PDF");
    expect(state.documents).toHaveLength(0);
    const original = upload(state);
    const before = structuredClone(state);
    expect(() =>
      appendVersion(state, actor, {
        ...file,
        ...original,
        expectedVersionId: original.versionId,
        mimeType: "image/png",
      }),
    ).toThrow("must be PDF");
    expect(state).toEqual(before);
  });
  it("supports read-only assigned reviewers, requires a return reason, and resets approval on replacement", () => {
    const state = emptyDocumentState();
    const original = upload(state);
    const doc = state.documents[0]!;
    const reviewId = request(state, doc.id);
    expect(submittalStatus(doc, state.reviews)).toBe("pending");
    expect(
      needsSubmittalReview(
        overview(state, reviewer).documents[0]!,
        overview(state, reviewer),
      ),
    ).toBe(true);
    expect(() =>
      applyDocumentAction(state, actor, {
        action: "resolveReview",
        reviewId,
        decision: "approved",
      }),
    ).toThrow("assigned reviewer");
    expect(() =>
      applyDocumentAction(state, reviewer, {
        action: "resolveReview",
        reviewId,
        decision: "changes_requested",
        comment: "   ",
      }),
    ).toThrow("Explain the changes");
    applyDocumentAction(state, reviewer, {
      action: "resolveReview",
      reviewId,
      decision: "changes_requested",
      comment: "Wrong pressure rating",
    });
    expect(submittalStatus(doc, state.reviews)).toBe("changes");
    expect(
      needsSubmittalReview(overview(state).documents[0]!, overview(state)),
    ).toBe(true);
    const revision = appendVersion(state, actor, {
      ...file,
      documentId: doc.id,
      expectedVersionId: original.versionId,
    });
    expect(submittalStatus(doc, state.reviews)).toBe("uploaded");
    const approvalId = request(state, doc.id);
    applyDocumentAction(state, reviewer, {
      action: "resolveReview",
      reviewId: approvalId,
      decision: "approved",
    });
    expect(submittalStatus(doc, state.reviews)).toBe("approved");
    appendVersion(state, actor, {
      ...file,
      documentId: doc.id,
      expectedVersionId: revision.versionId,
    });
    expect(submittalStatus(doc, state.reviews)).toBe("uploaded");
    expect(state.reviews[1]?.status).toBe("approved"); // immutable historical decision
  });
  it("cancels pending review on a new version and rejects stale decisions and stale metadata", () => {
    const state = emptyDocumentState();
    const first = upload(state);
    const doc = state.documents[0]!;
    const reviewId = request(state, doc.id);
    const oldUpdatedAt = doc.updatedAt;
    appendVersion(state, actor, {
      ...file,
      documentId: doc.id,
      expectedVersionId: first.versionId,
    });
    expect(state.reviews[0]?.status).toBe("superseded");
    expect(() =>
      applyDocumentAction(state, reviewer, {
        action: "resolveReview",
        reviewId,
        decision: "approved",
      }),
    ).toThrow("already been decided");
    expect(() =>
      applyDocumentAction(state, actor, {
        action: "updateSubmittal",
        documentId: doc.id,
        expectedUpdatedAt: oldUpdatedAt,
        details: defaultSubmittal("Wrong.pdf"),
      }),
    ).toThrow("changed");
    const updatedAt = doc.updatedAt;
    applyDocumentAction(state, actor, {
      action: "updateSubmittal",
      documentId: doc.id,
      expectedUpdatedAt: updatedAt,
      details: { ...defaultSubmittal("Correct.pdf"), category: "Plumbing" },
    });
    expect(doc.submittal).toMatchObject({
      number: "SUB-001",
      title: "Correct",
      category: "Plumbing",
    });
    expect(() =>
      applyDocumentAction(state, actor, {
        action: "updateSubmittal",
        documentId: doc.id,
        expectedUpdatedAt: updatedAt,
        details: defaultSubmittal("Stale.pdf"),
      }),
    ).toThrow("changed");
    expect(() =>
      applyDocumentAction(state, reviewer, {
        action: "updateSubmittal",
        documentId: doc.id,
        expectedUpdatedAt: doc.updatedAt,
        details: defaultSubmittal("Unauthorized.pdf"),
      }),
    ).toThrow();
    expect(() =>
      applyDocumentAction(state, actor, {
        action: "updateDocument",
        documentId: doc.id,
        status: "approved",
      }),
    ).toThrow("review workflow");
  });
  it("moves existing PDFs into the register, gives copies fresh references, and does not restore non-PDF historical versions", () => {
    const state = emptyDocumentState();
    const old = appendVersion(state, actor, {
      ...file,
      mimeType: "application/octet-stream",
    });
    const current = appendVersion(state, actor, {
      ...file,
      documentId: old.documentId,
      expectedVersionId: old.versionId,
    });
    applyDocumentAction(state, actor, {
      action: "registerSubmittal",
      documentId: old.documentId,
      expectedVersionId: current.versionId,
      details: defaultSubmittal(file.name),
    });
    expect(() =>
      applyDocumentAction(state, actor, {
        action: "restoreVersion",
        documentId: old.documentId,
        versionId: old.versionId,
      }),
    ).toThrow("must be PDF");
    const copy = applyDocumentAction(state, actor, {
      action: "copy",
      documentId: old.documentId,
    });
    expect(
      state.documents.find((doc) => doc.id === copy.id)?.submittal?.number,
    ).toBe("SUB-002");
    expect(submittalStatus(state.documents[1]!, state.reviews)).toBe(
      "uploaded",
    );
  });
  it("respects folder ACLs in register data and approval history", () => {
    const state = emptyDocumentState();
    const folder = applyDocumentAction(state, actor, {
      action: "createFolder",
      name: "Private",
    }).id;
    const doc = appendVersion(state, actor, {
      ...file,
      folderId: folder,
      submittal: defaultSubmittal(file.name),
    });
    applyDocumentAction(state, actor, {
      action: "setFolderPermissions",
      folderId: folder,
      permissions: [{ userId: actor.userId, role: "manager" }],
    });
    expect(visibleState(state, reviewer).documents).toEqual([]);
    expect(() =>
      applyDocumentAction(state, actor, {
        action: "createReview",
        documentIds: [doc.documentId],
        title: "Private",
        reviewerId: reviewer.userId,
      }),
    ).toThrow("needs access");
  });
  it("validates metadata dates, bounded fields, and malformed multipart JSON", () => {
    expect(parseSubmittalUpload(null)).toBeUndefined();
    expect(() => parseSubmittalUpload("{")).toThrow();
    expect(() =>
      submittalInputSchema.parse({
        ...defaultSubmittal(file.name),
        dueDate: "2026-02-30",
      }),
    ).toThrow();
    expect(() =>
      submittalInputSchema.parse({
        ...defaultSubmittal(file.name),
        category: "x".repeat(101),
      }),
    ).toThrow();
    expect(
      submittalInputSchema.parse({
        ...defaultSubmittal(file.name),
        dueDate: "2028-02-29",
      }).dueDate,
    ).toBe("2028-02-29");
    expect(
      documentActionSchema.parse({
        action: "updateSubmittal",
        documentId: randomUUID(),
        expectedUpdatedAt: new Date().toISOString(),
        details: defaultSubmittal(file.name),
      }).action,
    ).toBe("updateSubmittal");
  });
  it("ranks assigned approvals first, detects overdue non-approved PDFs, and ignores old-revision approvals", () => {
    const state = emptyDocumentState();
    upload(state);
    upload(state);
    const first = state.documents[0]!;
    const second = state.documents[1]!;
    first.submittal!.dueDate = "2026-01-01";
    request(state, second.id);
    const data = overview(state, reviewer);
    expect(submittalRegister(data, "2026-10-09")[0]?.document.id).toBe(
      second.id,
    );
    expect(submittalOverdue(first, state.reviews, "2026-10-09")).toBe(true);
    const id = request(state, first.id);
    applyDocumentAction(state, reviewer, {
      action: "resolveReview",
      reviewId: id,
      decision: "approved",
    });
    expect(submittalOverdue(first, state.reviews, "2026-10-09")).toBe(false);
    first.currentVersionId = randomUUID();
    expect(submittalStatus(first, state.reviews)).toBe("uploaded");
  });
});
