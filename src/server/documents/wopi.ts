import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import {
  assertDocumentAccess,
  documentActor,
  type DocumentAccess,
} from "./access";
import {
  accessibleDocument,
  appendVersion,
  folderRole,
  type DocumentActor,
} from "./domain";
import { discoverEditorAction } from "./editor-discovery";
import {
  editorExtension,
  getDocumentEditorConfig,
  type DocumentEditorConfig,
} from "./editor-config";
import {
  editorRequestToken,
  issueEditorToken,
  verifyEditorToken,
  type EditorTokenClaims,
} from "./editor-token";
import { verifyWopiProof } from "./wopi-proof";
import { mutateWorkspace, readWorkspace } from "./service";
import {
  MAX_DOCUMENT_FILE_BYTES,
  readDocumentBlob,
  writeDocumentBlob,
} from "./storage";
import type {
  DocumentEditorLaunch,
  DocumentState,
  DocumentVersion,
} from "./types";

const mimeByExtension: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};
export function editorDocument(
  state: DocumentState,
  actor: DocumentActor,
  documentId: string,
  write = false,
) {
  const document = accessibleDocument(state, actor, documentId, { write });
  const extension = editorExtension(document.name);
  const version = state.versions.find(
    (entry) =>
      entry.id === document.currentVersionId &&
      entry.documentId === document.id,
  );
  if (
    !extension ||
    document.officeWebUrl ||
    !version ||
    editorExtension(version.name) !== extension ||
    ![mimeByExtension[extension], "application/zip"].includes(version.mimeType)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The live editor supports uploaded DOCX, XLSX, PPTX, ODT, ODS and ODP files. Upload an editable file first.",
    });
  return { document, version, extension };
}
export function editorCanWrite(
  state: DocumentState,
  actor: DocumentActor,
  documentId: string,
) {
  const { document } = editorDocument(state, actor, documentId);
  return (
    actor.canWrite &&
    folderRole(state, actor, document.folderId) !== "viewer" &&
    (!document.lockedBy || document.lockedBy === actor.userId)
  );
}
export async function launchDocumentEditor(
  access: DocumentAccess,
  documentId: string,
): Promise<DocumentEditorLaunch> {
  const config = getDocumentEditorConfig();
  const state = await readWorkspace(access);
  const actor = documentActor(access, []);
  const { version, extension } = editorDocument(state, actor, documentId);
  const mode = editorCanWrite(state, actor, documentId) ? "edit" : "view";
  const wopiSrc = new URL(
    `/api/job-documents/wopi/${documentId}`,
    config.publicUrl,
  );
  wopiSrc.searchParams.set("jobId", access.job.id);
  const actionUrl = await discoverEditorAction(
    config,
    extension,
    mode,
    wopiSrc.href,
  );
  const token = issueEditorToken(config, {
    organizationId: access.job.organizationId,
    jobId: access.job.id,
    documentId,
    userId: access.user.id,
    mode,
    extension,
  });
  return {
    ...token,
    actionUrl,
    wopiSrc: wopiSrc.href,
    mode,
    provider: "collabora",
    documentId,
    versionId: version.id,
  };
}
export function assertEditorClaimAccess(
  claims: EditorTokenClaims,
  access: DocumentAccess,
) {
  if (
    claims.userId !== access.user.id ||
    claims.jobId !== access.job.id ||
    claims.organizationId !== access.job.organizationId ||
    claims.expiresAt <= Date.now()
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "The editor session is no longer authorized. Reopen this document.",
    });
}
export async function authorizeWopiRequest(
  request: Request,
  documentId: string,
  jobId: string,
) {
  const config = getDocumentEditorConfig();
  const token = editorRequestToken(request);
  const claims = verifyEditorToken(config, token, { documentId, jobId });
  // The host trusts the configured editor's signed callback, not a Clerk cookie.
  await verifyWopiProof(request, token, config);
  const access = await assertDocumentAccess(claims.userId, claims.jobId);
  assertEditorClaimAccess(claims, access);
  return { config, claims, access };
}
export function assertEditorTimestamp(
  timestamp: string | null,
  version: DocumentVersion,
) {
  const parsed =
    timestamp &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      timestamp,
    )
      ? Date.parse(timestamp)
      : NaN;
  // Missing timestamps (including forced-overwrite retries) fail closed.
  if (!Number.isFinite(parsed) || parsed !== Date.parse(version.createdAt))
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The file changed outside this editor. Reload its current version before saving.",
    });
}
function assertClaimExtension(claims: EditorTokenClaims, extension: string) {
  if (claims.extension !== extension)
    throw new TRPCError({
      code: "CONFLICT",
      message: "The document type changed. Reopen the editor.",
    });
}
export async function wopiFileInfo(
  config: DocumentEditorConfig,
  claims: EditorTokenClaims,
  access: DocumentAccess,
) {
  const state = await readWorkspace(access);
  const actor = documentActor(access, []);
  const { document, version, extension } = editorDocument(
    state,
    actor,
    claims.documentId,
  );
  assertClaimExtension(claims, extension);
  const writable =
    claims.mode === "edit" && editorCanWrite(state, actor, document.id);
  return {
    BaseFileName: document.name,
    OwnerId: document.createdBy,
    Size: version.size,
    UserId: claims.userId,
    UserFriendlyName: access.user.name ?? access.user.email,
    Version: version.id,
    LastModifiedTime: version.createdAt,
    UserCanWrite: writable,
    ReadOnly: !writable,
    SupportsUpdate: writable,
    SupportsLocks: false,
    SupportsGetLock: false,
    SupportsRename: false,
    UserCanRename: false,
    UserCanNotWriteRelative: true,
    PostMessageOrigin: config.publicUrl.origin,
    ClosePostMessage: true,
    EditModePostMessage: true,
    DownloadAsPostMessage: false,
    EnableInsertRemoteImage: false,
    EnableInsertRemoteFile: false,
    EnableShare: false,
  };
}
export async function wopiReadFile(
  claims: EditorTokenClaims,
  access: DocumentAccess,
) {
  const state = await readWorkspace(access);
  const { document, version, extension } = editorDocument(
    state,
    documentActor(access, []),
    claims.documentId,
  );
  assertClaimExtension(claims, extension);
  const bytes = await readDocumentBlob(
    access.job.organizationId,
    version.sha256,
  );
  return { bytes, document, version };
}
export function applyEditorSave(
  state: DocumentState,
  actor: DocumentActor,
  claims: EditorTokenClaims,
  timestamp: string | null,
  bytes: Uint8Array,
) {
  if (
    claims.userId !== actor.userId ||
    claims.jobId !== actor.jobId ||
    claims.expiresAt <= Date.now()
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "The editor session is no longer authorized.",
    });
  if (claims.mode !== "edit")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This editor session is read-only.",
    });
  const { document, version, extension } = editorDocument(
    state,
    actor,
    claims.documentId,
    true,
  );
  assertClaimExtension(claims, extension);
  assertEditorTimestamp(timestamp, version);
  if (!bytes.length || bytes.length > MAX_DOCUMENT_FILE_BYTES)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Editor files must be between 1 byte and 50 MB.",
    });
  if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The editor returned an unsupported or invalid document format.",
    });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 === version.sha256)
    return {
      documentId: document.id,
      versionId: version.id,
      LastModifiedTime: version.createdAt,
      changed: false,
    };
  const result = appendVersion(state, actor, {
    documentId: document.id,
    expectedVersionId: version.id,
    name: document.name,
    size: bytes.length,
    mimeType: mimeByExtension[extension]!,
    sha256,
    revisionSource: "editor",
  });
  const saved = state.versions.find((entry) => entry.id === result.versionId)!;
  return { ...result, LastModifiedTime: saved.createdAt, changed: true };
}
export async function wopiSaveFile(
  claims: EditorTokenClaims,
  access: DocumentAccess,
  timestamp: string | null,
  bytes: Uint8Array,
) {
  assertEditorClaimAccess(claims, access);
  return mutateWorkspace(
    claims.userId,
    claims.jobId,
    async (state, actor, fresh) => {
      assertEditorClaimAccess(claims, fresh);
      const result = applyEditorSave(state, actor, claims, timestamp, bytes);
      if (result.changed)
        await writeDocumentBlob(fresh.job.organizationId, bytes);
      return result;
    },
  );
}
export function wopiErrorResponse(error: unknown) {
  const status =
    error instanceof ZodError
      ? 400
      : error instanceof TRPCError
        ? ((
            {
              UNAUTHORIZED: 401,
              FORBIDDEN: 403,
              NOT_FOUND: 404,
              BAD_REQUEST: 400,
              CONFLICT: 409,
              PAYLOAD_TOO_LARGE: 413,
              TIMEOUT: 408,
              TOO_MANY_REQUESTS: 429,
              PRECONDITION_FAILED: 503,
            } as Record<string, number>
          )[error.code] ?? 500)
        : 500;
  // Never log callback Request objects, URLs or token-bearing errors.
  if (status === 500)
    console.error(
      "Document editor callback failed",
      error instanceof Error ? error.name : "Unknown error",
    );
  return Response.json(
    status === 409
      ? { COOLStatusCode: 1010 }
      : {
          error:
            status === 500
              ? "The editor file operation failed."
              : error instanceof Error
                ? error.message
                : "The editor request was rejected.",
        },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
