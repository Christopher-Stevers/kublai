// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { DocumentAccess } from "./access";
import type { DocumentState } from "./types";
import type { EditorTokenClaims } from "./editor-token";
const mocks = vi.hoisted(() => ({
  state: null as DocumentState | null,
  access: null as DocumentAccess | null,
  assertAccess: vi.fn(),
  proof: vi.fn(),
  persist: vi.fn(),
}));
vi.mock("./access", () => ({
  assertDocumentAccess: mocks.assertAccess,
  documentActor: (access: DocumentAccess) => ({
    userId: access.user.id,
    jobId: access.job.id,
    canWrite: access.canWrite,
    canManage: access.canManage,
    memberIds: [access.user.id, "reviewer"],
  }),
}));
vi.mock("./service", () => ({
  readWorkspace: () => Promise.resolve(structuredClone(mocks.state)),
  mutateWorkspace: async (
    _userId: string,
    _jobId: string,
    mutation: (
      state: DocumentState,
      actor: object,
      access: DocumentAccess,
    ) => Promise<unknown>,
  ) => {
    const access = mocks.access!;
    const draft = structuredClone(mocks.state!);
    const result = await mutation(
      draft,
      {
        userId: access.user.id,
        jobId: access.job.id,
        canWrite: access.canWrite,
        canManage: access.canManage,
        memberIds: [access.user.id],
      },
      access,
    );
    mocks.state = draft;
    return result;
  },
}));
vi.mock("./wopi-proof", () => ({ verifyWopiProof: mocks.proof }));
vi.mock("./storage", () => ({
  MAX_DOCUMENT_FILE_BYTES: 50 * 1024 * 1024,
  writeDocumentBlob: mocks.persist,
  readDocumentBlob: () => Buffer.from("PK\x03\x04test"),
}));
import {
  appendVersion,
  applyDocumentAction,
  emptyDocumentState,
  type DocumentActor,
} from "./domain";
import {
  applyEditorSave,
  assertEditorClaimAccess,
  assertEditorTimestamp,
  authorizeWopiRequest,
  editorCanWrite,
  editorDocument,
  wopiErrorResponse,
  wopiFileInfo,
  wopiSaveFile,
} from "./wopi";
import { getDocumentEditorConfig } from "./editor-config";
import { issueEditorToken, verifyEditorToken } from "./editor-token";
import {
  registerEditorSaveReceipt,
  readEditorSaveReceipt,
} from "./editor-save-receipt";
const actor: DocumentActor = {
  userId: "writer",
  jobId: randomUUID(),
  canWrite: true,
  canManage: true,
  memberIds: ["writer", "reviewer"],
};
const organizationId = randomUUID();
const original = Buffer.from("PK\x03\x04original content");
const changed = Buffer.from("PK\x03\x04edited content");
const mime =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let claims: EditorTokenClaims;
beforeEach(() => {
  vi.stubEnv("COLLABORA_URL", "https://office.example.com");
  vi.stubEnv("FOREMANHQ_PUBLIC_URL", "https://app.example.com");
  vi.stubEnv("DOCUMENT_EDITOR_SECRET", "test-only-secret-".repeat(4));
  mocks.state = emptyDocumentState();
  mocks.persist.mockReset().mockResolvedValue("sha");
  mocks.proof.mockReset().mockResolvedValue(undefined);
  const uploaded = appendVersion(mocks.state, actor, {
    name: "Report.docx",
    mimeType: mime,
    size: original.length,
    sha256: createHash("sha256").update(original).digest("hex"),
  });
  mocks.access = {
    user: { id: actor.userId, name: "Writer", email: "writer@example.com" },
    job: { id: actor.jobId, organizationId },
    canWrite: true,
    canManage: true,
  } as DocumentAccess;
  mocks.assertAccess.mockReset().mockResolvedValue(mocks.access);
  const config = getDocumentEditorConfig();
  const issued = issueEditorToken(config, {
    userId: actor.userId,
    organizationId,
    jobId: actor.jobId,
    documentId: uploaded.documentId,
    mode: "edit",
    extension: "docx",
  });
  claims = verifyEditorToken(config, issued.accessToken, {
    jobId: actor.jobId,
    documentId: uploaded.documentId,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function currentVersion() {
  return mocks.state!.versions.find(
    (version) => version.id === mocks.state!.documents[0]!.currentVersionId,
  )!;
}

describe("Live editor immutable saves", () => {
  it("requires timestamp CAS, rejects a serialized stale coauthor save, and appends immutable content", () => {
    const timestamp = currentVersion().createdAt;
    const result = applyEditorSave(
      mocks.state!,
      actor,
      claims,
      timestamp,
      changed,
    );
    expect(result.changed).toBe(true);
    expect(result.LastModifiedTime).not.toBe(timestamp);
    expect(mocks.state!.versions).toHaveLength(2);
    expect(mocks.state!.versions[0]!.sha256).toBe(
      createHash("sha256").update(original).digest("hex"),
    );
    expect(() =>
      applyEditorSave(
        mocks.state!,
        actor,
        claims,
        timestamp,
        Buffer.from("PK\x03\x04second writer"),
      ),
    ).toThrow("changed outside");
    expect(() =>
      applyEditorSave(mocks.state!, actor, claims, null, changed),
    ).toThrow("changed outside");
    expect(mocks.state!.versions).toHaveLength(2);
  });
  it("never trusts force-overwrite or malformed timestamps", () => {
    for (const timestamp of [
      null,
      "",
      "bad",
      "2020-01-01",
      "2020-01-01T00:00:00Z",
    ])
      expect(() =>
        assertEditorTimestamp(timestamp, currentVersion()),
      ).toThrow();
    expect(() =>
      assertEditorTimestamp(currentVersion().createdAt, currentVersion()),
    ).not.toThrow();
  });
  it("uses monotonic version timestamps even when saves and restore happen in one clock millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(currentVersion().createdAt));
    const first = currentVersion();
    applyEditorSave(mocks.state!, actor, claims, first.createdAt, changed);
    const second = currentVersion();
    applyDocumentAction(mocks.state!, actor, {
      action: "restoreVersion",
      documentId: claims.documentId,
      versionId: first.id,
    });
    const third = currentVersion();
    expect(Date.parse(second.createdAt)).toBeGreaterThan(
      Date.parse(first.createdAt),
    );
    expect(Date.parse(third.createdAt)).toBeGreaterThan(
      Date.parse(second.createdAt),
    );
  });
  it("deduplicates no-change autosave and supersedes pending review on a changed save", () => {
    expect(
      applyEditorSave(
        mocks.state!,
        actor,
        claims,
        currentVersion().createdAt,
        original,
      ).changed,
    ).toBe(false);
    expect(mocks.state!.versions).toHaveLength(1);
    applyDocumentAction(mocks.state!, actor, {
      action: "createReview",
      documentIds: [claims.documentId],
      title: "Check report",
      reviewerId: "reviewer",
    });
    applyEditorSave(
      mocks.state!,
      actor,
      claims,
      currentVersion().createdAt,
      changed,
    );
    expect(mocks.state!.reviews[0]!.status).toBe("superseded");
    expect(mocks.state!.activity.at(-1)!.action).toBe("editor_save");
  });
  it("rejects read-only tokens even after user gains editor permission", () => {
    expect(() =>
      applyEditorSave(
        mocks.state!,
        actor,
        { ...claims, mode: "view" },
        currentVersion().createdAt,
        changed,
      ),
    ).toThrow("read-only");
    expect(() =>
      applyEditorSave(
        mocks.state!,
        { ...actor, canWrite: false, canManage: false },
        claims,
        currentVersion().createdAt,
        changed,
      ),
    ).toThrow("permission");
  });
  it("rejects revoked folder access, locks, recycled docs and changed type", () => {
    mocks.state!.documents[0]!.lockedBy = "another-user";
    expect(editorCanWrite(mocks.state!, actor, claims.documentId)).toBe(false);
    expect(() =>
      applyEditorSave(
        mocks.state!,
        actor,
        claims,
        currentVersion().createdAt,
        changed,
      ),
    ).toThrow("locked");
    mocks.state!.documents[0]!.lockedBy = null;
    mocks.state!.documents[0]!.deletedAt = new Date().toISOString();
    expect(() =>
      editorDocument(mocks.state!, actor, claims.documentId),
    ).toThrow("not found");
    mocks.state!.documents[0]!.deletedAt = null;
    mocks.state!.documents[0]!.name = "Renamed.xlsx";
    expect(() =>
      applyEditorSave(
        mocks.state!,
        actor,
        claims,
        currentVersion().createdAt,
        changed,
      ),
    ).toThrow("supports uploaded");
  });
  it("rejects expired/wrong user/job claims and arbitrary body formats", () => {
    for (const override of [
      { userId: "other" },
      { jobId: randomUUID() },
      { expiresAt: Date.now() - 1 },
    ])
      expect(() =>
        applyEditorSave(
          mocks.state!,
          actor,
          { ...claims, ...override },
          currentVersion().createdAt,
          changed,
        ),
      ).toThrow("no longer authorized");
    expect(() =>
      applyEditorSave(
        mocks.state!,
        actor,
        claims,
        currentVersion().createdAt,
        Buffer.from("<html>"),
      ),
    ).toThrow("invalid document format");
  });
  it("rechecks fresh permissions inside the transaction before publishing any bytes", async () => {
    const stale = mocks.access!;
    mocks.access = { ...stale, canWrite: false, canManage: false };
    await expect(
      wopiSaveFile(claims, stale, currentVersion().createdAt, changed),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.state!.versions).toHaveLength(1);
  });
  it("does not commit a new version when immutable blob persistence fails", async () => {
    mocks.persist.mockRejectedValue(new Error("disk full"));
    await expect(
      wopiSaveFile(claims, mocks.access!, currentVersion().createdAt, changed),
    ).rejects.toThrow("disk full");
    expect(mocks.state!.versions).toHaveLength(1);
  });
  it("publishes receipt only after blob persistence and transaction completion", async () => {
    const requestId = randomUUID();
    registerEditorSaveReceipt(
      mocks.state!,
      actor,
      claims.documentId,
      requestId,
    );
    let finish: () => void = () => undefined;
    const persisted = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.persist.mockReturnValue(persisted);
    const save = wopiSaveFile(
      claims,
      mocks.access!,
      currentVersion().createdAt,
      changed,
      JSON.stringify({ foremanhqSaveRequestId: requestId }),
    );
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(
      readEditorSaveReceipt(mocks.state!, actor, claims.documentId, requestId)
        .status,
    ).toBe("pending");
    expect(mocks.state!.versions).toHaveLength(1);
    finish();
    const saved = await save;
    expect(
      readEditorSaveReceipt(mocks.state!, actor, claims.documentId, requestId),
    ).toMatchObject({
      requestId,
      status: "committed",
      versionId: saved.versionId,
    });
  });
  it("leaves receipts pending for failed, stale and unauthorized writes", async () => {
    const requestId = randomUUID();
    registerEditorSaveReceipt(
      mocks.state!,
      actor,
      claims.documentId,
      requestId,
    );
    const metadata = JSON.stringify({ foremanhqSaveRequestId: requestId });
    await expect(
      wopiSaveFile(claims, mocks.access!, null, changed, metadata),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      wopiSaveFile(
        { ...claims, mode: "view" },
        mocks.access!,
        currentVersion().createdAt,
        changed,
        metadata,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    mocks.persist.mockRejectedValue(new Error("disk full"));
    await expect(
      wopiSaveFile(
        claims,
        mocks.access!,
        currentVersion().createdAt,
        changed,
        metadata,
      ),
    ).rejects.toThrow("disk full");
    expect(
      readEditorSaveReceipt(mocks.state!, actor, claims.documentId, requestId)
        .status,
    ).toBe("pending");
    expect(mocks.state!.versions).toHaveLength(1);
  });
  it("confirms unchanged bytes without manufacturing another version and ignores stale metadata on autosave", async () => {
    const requestId = randomUUID();
    registerEditorSaveReceipt(
      mocks.state!,
      actor,
      claims.documentId,
      requestId,
    );
    const saved = await wopiSaveFile(
      claims,
      mocks.access!,
      currentVersion().createdAt,
      original,
      JSON.stringify({ foremanhqSaveRequestId: requestId }),
    );
    expect(saved.changed).toBe(false);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.state!.versions).toHaveLength(1);
    expect(
      readEditorSaveReceipt(mocks.state!, actor, claims.documentId, requestId),
    ).toMatchObject({ status: "committed", versionId: saved.versionId });
    await wopiSaveFile(
      claims,
      mocks.access!,
      currentVersion().createdAt,
      changed,
      "undefined",
    );
    expect(mocks.state!.versions).toHaveLength(2);
    expect(
      readEditorSaveReceipt(mocks.state!, actor, claims.documentId, requestId)
        .versionId,
    ).toBe(saved.versionId);
  });
});

describe("WOPI current authorization and metadata", () => {
  it("always verifies proof and re-reads current account/job access for callbacks", async () => {
    const config = getDocumentEditorConfig();
    const issued = issueEditorToken(config, claims);
    const request = new Request(
      `https://app.example.com/api/job-documents/wopi/${claims.documentId}?jobId=${claims.jobId}&access_token=${issued.accessToken}`,
    );
    await authorizeWopiRequest(request, claims.documentId, claims.jobId);
    expect(mocks.proof).toHaveBeenCalledOnce();
    expect(mocks.assertAccess).toHaveBeenCalledWith(
      claims.userId,
      claims.jobId,
    );
    mocks.assertAccess.mockRejectedValue(new TRPCError({ code: "FORBIDDEN" }));
    await expect(
      authorizeWopiRequest(request, claims.documentId, claims.jobId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("refuses a token after organization membership or job ownership changes", () => {
    expect(() =>
      assertEditorClaimAccess(claims, {
        ...mocks.access!,
        job: { ...mocks.access!.job, organizationId: randomUUID() },
      }),
    ).toThrow("no longer authorized");
  });
  it("advertises correct view-only capability and stable content timestamp", async () => {
    const result = await wopiFileInfo(
      getDocumentEditorConfig(),
      { ...claims, mode: "view" },
      mocks.access!,
    );
    expect(result).toMatchObject({
      BaseFileName: "Report.docx",
      Version: currentVersion().id,
      LastModifiedTime: currentVersion().createdAt,
      UserCanWrite: false,
      ReadOnly: true,
      UserCanNotWriteRelative: true,
      SupportsLocks: false,
      PostMessageOrigin: "https://app.example.com",
    });
  });
  it("returns Collabora's expected conflict response without tokens or stack data", async () => {
    const response = wopiErrorResponse(
      new TRPCError({ code: "CONFLICT", message: "External revision" }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ COOLStatusCode: 1010 });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
