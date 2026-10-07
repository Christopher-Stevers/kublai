import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  DocumentAction,
  DocumentFolder,
  DocumentRole,
  DocumentState,
  DocumentVersion,
  JobDocument,
} from "./types";

export type DocumentActor = {
  userId: string;
  jobId: string;
  canWrite: boolean;
  canManage: boolean;
  memberIds: string[];
  reviewers?: { userId: string; canWrite: boolean; canManage: boolean }[];
};
export const MAX_DOCUMENTS = 2000;
export const MAX_WORKSPACE_BYTES = 12 * 1024 * 1024;
export function emptyDocumentState(): DocumentState {
  return {
    schemaVersion: 1,
    folders: [],
    documents: [],
    versions: [],
    comments: [],
    activity: [],
    reviews: [],
    transmittals: [],
  };
}
function fail(
  code:
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "CONFLICT"
    | "BAD_REQUEST"
    | "PAYLOAD_TOO_LARGE",
  message: string,
): never {
  throw new TRPCError({ code, message });
}
export function folderRole(
  state: DocumentState,
  actor: DocumentActor,
  folderId: string | null,
): DocumentRole | null {
  const visited = new Set<string>();
  let effective: DocumentRole | null | undefined;
  while (folderId) {
    if (visited.has(folderId))
      return fail("CONFLICT", "Folder hierarchy is invalid.");
    visited.add(folderId);
    const folder = state.folders.find((entry) => entry.id === folderId);
    if (!folder) return fail("NOT_FOUND", "Folder not found.");
    if (effective === undefined && folder.permissions.length)
      effective =
        folder.permissions.find((entry) => entry.userId === actor.userId)
          ?.role ?? null;
    folderId = folder.parentId;
  }
  if (actor.canManage) return "manager";
  if (effective === null) return null;
  const role = effective ?? (actor.canWrite ? "editor" : "viewer");
  return actor.canWrite ? role : "viewer";
}
export function assertFolderRole(
  state: DocumentState,
  actor: DocumentActor,
  folderId: string | null,
  required: DocumentRole = "viewer",
) {
  const role = folderRole(state, actor, folderId);
  if (!role) return fail("NOT_FOUND", "Folder not found.");
  const ranks = { viewer: 0, editor: 1, manager: 2 };
  if (ranks[role] < ranks[required])
    return fail("FORBIDDEN", "You do not have permission for this folder.");
  return role;
}
export function accessibleDocument(
  state: DocumentState,
  actor: DocumentActor,
  id: string,
  options: {
    write?: boolean;
    allowDeleted?: boolean;
    ignoreLock?: boolean;
  } = {},
) {
  const doc = state.documents.find(
    (entry) => entry.id === id && entry.jobId === actor.jobId,
  );
  if (!doc) return fail("NOT_FOUND", "Document not found.");
  assertFolderRole(
    state,
    actor,
    doc.folderId,
    options.write ? "editor" : "viewer",
  );
  if (
    doc.deletedAt &&
    (!options.allowDeleted ||
      !actor.canWrite ||
      folderRole(state, actor, doc.folderId) === "viewer")
  )
    return fail("NOT_FOUND", "Document not found.");
  if (
    options.write &&
    !options.ignoreLock &&
    doc.lockedBy &&
    doc.lockedBy !== actor.userId
  )
    return fail("CONFLICT", "Document is locked by another member.");
  return doc;
}
function siblingName(
  state: DocumentState,
  name: string,
  folderId: string | null,
  except?: string,
) {
  if (
    state.documents.some(
      (doc) =>
        doc.id !== except &&
        !doc.deletedAt &&
        doc.folderId === folderId &&
        doc.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    fail(
      "CONFLICT",
      "A document with this name already exists in this folder.",
    );
}
function folderName(
  state: DocumentState,
  name: string,
  parentId: string | null,
  except?: string,
) {
  if (
    state.folders.some(
      (folder) =>
        folder.id !== except &&
        folder.parentId === parentId &&
        folder.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  )
    fail("CONFLICT", "A folder with this name already exists here.");
}
function audit(
  state: DocumentState,
  actor: DocumentActor,
  action: string,
  detail: string,
  documentId: string | null = null,
  folderId: string | null = null,
) {
  state.activity.push({
    id: randomUUID(),
    action,
    detail,
    documentId,
    folderId,
    createdBy: actor.userId,
    createdAt: new Date().toISOString(),
  });
}
export function assertStateBounds(state: DocumentState) {
  if (
    state.documents.length > MAX_DOCUMENTS ||
    state.folders.length > 500 ||
    state.versions.length > 20000 ||
    state.comments.length > 20000 ||
    state.activity.length > 50000 ||
    state.reviews.length > 5000 ||
    state.transmittals.length > 5000 ||
    Buffer.byteLength(JSON.stringify(state)) > MAX_WORKSPACE_BYTES
  )
    fail(
      "PAYLOAD_TOO_LARGE",
      "This job has reached its document workspace limit. Contact your administrator before adding more records.",
    );
}
function supersedeReviews(state: DocumentState, documentId: string) {
  for (const review of state.reviews) {
    if (
      review.status === "pending" &&
      review.documents.some((doc) => doc.documentId === documentId)
    ) {
      review.status = "superseded";
      review.resolvedAt = new Date().toISOString();
      review.comment =
        "The document was revised or recycled. Request a new review for the current versions.";
      for (const entry of review.documents) {
        const doc = state.documents.find(
          (item) => item.id === entry.documentId,
        );
        if (doc?.status === "in_review") doc.status = "draft";
      }
    }
  }
}
function snapshot(state: DocumentState, actor: DocumentActor, ids: string[]) {
  return ids.map((id) => {
    const doc = accessibleDocument(state, actor, id, { write: true });
    return {
      documentId: doc.id,
      versionId: doc.currentVersionId,
      name: doc.name,
      officeWebUrl: doc.officeWebUrl,
    };
  });
}
function newDocument(
  state: DocumentState,
  actor: DocumentActor,
  name: string,
  folderId: string | null,
  officeWebUrl: string | null = null,
) {
  assertFolderRole(state, actor, folderId, "editor");
  siblingName(state, name, folderId);
  const now = new Date().toISOString();
  const doc: JobDocument = {
    id: randomUUID(),
    jobId: actor.jobId,
    folderId,
    name,
    description: "",
    tags: [],
    status: "draft",
    currentVersionId: null,
    officeWebUrl,
    lockedBy: null,
    deletedAt: null,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };
  state.documents.push(doc);
  return doc;
}
export function appendVersion(
  state: DocumentState,
  actor: DocumentActor,
  input: {
    documentId?: string;
    folderId?: string | null;
    expectedVersionId?: string;
    name: string;
    size: number;
    mimeType: string;
    sha256: string;
  },
) {
  const recent = state.versions.filter(
    (version) =>
      version.createdBy === actor.userId &&
      Date.parse(version.createdAt) > Date.now() - 86_400_000,
  );
  if (
    recent.length >= 200 ||
    recent.reduce((total, version) => total + version.size, 0) + input.size >
      2 * 1024 * 1024 * 1024
  )
    fail(
      "PAYLOAD_TOO_LARGE",
      "Daily job upload limit reached (200 versions or 2 GB per member).",
    );
  const doc = input.documentId
    ? accessibleDocument(state, actor, input.documentId, { write: true })
    : newDocument(state, actor, input.name, input.folderId ?? null);
  if (doc.officeWebUrl)
    fail(
      "BAD_REQUEST",
      "Linked Office documents are versioned in Microsoft 365.",
    );
  if (
    input.documentId &&
    (!input.expectedVersionId ||
      input.expectedVersionId !== doc.currentVersionId)
  )
    fail(
      "CONFLICT",
      "A newer version exists. Refresh the document before uploading.",
    );
  const version: DocumentVersion = {
    id: randomUUID(),
    documentId: doc.id,
    number:
      state.versions.filter((entry) => entry.documentId === doc.id).length + 1,
    name: input.name,
    size: input.size,
    mimeType: input.mimeType,
    sha256: input.sha256,
    createdBy: actor.userId,
    createdAt: new Date().toISOString(),
    restoredFromVersionId: null,
  };
  state.versions.push(version);
  doc.currentVersionId = version.id;
  doc.updatedAt = version.createdAt;
  doc.status = "draft";
  supersedeReviews(state, doc.id);
  audit(
    state,
    actor,
    "upload",
    `Uploaded version ${version.number}`,
    doc.id,
    doc.folderId,
  );
  assertStateBounds(state);
  return { documentId: doc.id, versionId: version.id };
}
/** Mutates a transaction-owned copy only. The caller commits the entire state atomically. */
export function applyDocumentAction(
  state: DocumentState,
  actor: DocumentActor,
  action: DocumentAction,
): { id: string } {
  const now = new Date().toISOString();
  let resultId: string;
  let auditDocument: string | null = null;
  let auditFolder: string | null = null;
  let detail: string = action.action;
  switch (action.action) {
    case "createFolder": {
      const parentId = action.parentId ?? null;
      assertFolderRole(state, actor, parentId, "editor");
      let ancestor = parentId;
      let depth = 1;
      while (ancestor) {
        if (++depth > 50)
          fail("BAD_REQUEST", "Folders cannot be nested more than 50 levels.");
        ancestor =
          state.folders.find((folder) => folder.id === ancestor)?.parentId ??
          null;
      }
      folderName(state, action.name, parentId);
      const folder: DocumentFolder = {
        id: randomUUID(),
        name: action.name,
        parentId,
        permissions: [],
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      state.folders.push(folder);
      resultId = auditFolder = folder.id;
      detail = `Created folder ${folder.name}`;
      break;
    }
    case "updateFolder": {
      assertFolderRole(state, actor, action.folderId, "manager");
      const folder = state.folders.find(
        (entry) => entry.id === action.folderId,
      )!;
      const parent =
        action.parentId === undefined ? folder.parentId : action.parentId;
      assertFolderRole(state, actor, parent, "manager");
      let ancestor = parent;
      let depth = 0;
      while (ancestor) {
        if (++depth >= 50 || ancestor === folder.id)
          fail(
            "BAD_REQUEST",
            "A folder cannot be moved inside itself or nested more than 50 levels.",
          );
        ancestor =
          state.folders.find((entry) => entry.id === ancestor)?.parentId ??
          null;
      }
      // Moving a folder changes inherited access: require every descendant to be manageable.
      for (const child of state.folders) {
        let current: DocumentFolder | undefined = child;
        let descendantDepth = 0;
        while (current) {
          if (current.id === folder.id) {
            if (depth + descendantDepth + 1 > 50)
              fail(
                "BAD_REQUEST",
                "Moving this folder would nest a descendant more than 50 levels.",
              );
            assertFolderRole(state, actor, child.id, "manager");
            break;
          }
          descendantDepth++;
          current = state.folders.find(
            (entry) => entry.id === current?.parentId,
          );
        }
      }
      folderName(state, action.name ?? folder.name, parent, folder.id);
      folder.name = action.name ?? folder.name;
      folder.parentId = parent;
      folder.updatedAt = now;
      resultId = auditFolder = folder.id;
      detail = `Updated folder ${folder.name}`;
      break;
    }
    case "setFolderPermissions": {
      assertFolderRole(state, actor, action.folderId, "manager");
      if (
        action.permissions.some(
          (permission) => !actor.memberIds.includes(permission.userId),
        ) ||
        new Set(action.permissions.map((permission) => permission.userId))
          .size !== action.permissions.length
      )
        fail(
          "BAD_REQUEST",
          "Choose each approved organization member at most once.",
        );
      const folder = state.folders.find(
        (entry) => entry.id === action.folderId,
      )!;
      folder.permissions = action.permissions;
      folder.updatedAt = now;
      resultId = auditFolder = folder.id;
      detail = `Updated access for ${folder.name}`;
      break;
    }
    case "linkOffice": {
      const doc = newDocument(
        state,
        actor,
        action.name,
        action.folderId ?? null,
        action.webUrl,
      );
      resultId = auditDocument = doc.id;
      auditFolder = doc.folderId;
      detail = `Linked ${doc.name}`;
      break;
    }
    case "createReview": {
      if (
        state.reviews.some(
          (review) =>
            review.status === "pending" &&
            review.documents.some((doc) =>
              action.documentIds.includes(doc.documentId),
            ),
        )
      )
        fail("CONFLICT", "A selected document already has a pending review.");
      if (!actor.memberIds.includes(action.reviewerId))
        fail("BAD_REQUEST", "Choose an approved organization reviewer.");
      const documents = snapshot(state, actor, action.documentIds);
      if (documents.some((doc) => !doc.versionId || doc.officeWebUrl))
        fail(
          "BAD_REQUEST",
          "Upload an exported Office revision before requesting approval. A live Office link does not freeze a reviewable version.",
        );
      const reviewer = {
        ...actor,
        userId: action.reviewerId,
        canManage: false,
        canWrite: false,
        ...actor.reviewers?.find(
          (member) => member.userId === action.reviewerId,
        ),
      };
      if (
        documents.some(
          (entry) =>
            !folderRole(
              state,
              reviewer,
              state.documents.find((doc) => doc.id === entry.documentId)!
                .folderId,
            ),
        )
      )
        fail(
          "BAD_REQUEST",
          "The selected reviewer needs access to every document.",
        );
      const id = randomUUID();
      state.reviews.push({
        id,
        title: action.title,
        documents,
        reviewerId: action.reviewerId,
        status: "pending",
        comment: "",
        createdBy: actor.userId,
        createdAt: now,
        resolvedAt: null,
      });
      for (const entry of documents)
        state.documents.find((doc) => doc.id === entry.documentId)!.status =
          "in_review";
      resultId = id;
      detail = `Requested review: ${action.title}`;
      break;
    }
    case "resolveReview": {
      const review = state.reviews.find(
        (entry) => entry.id === action.reviewId,
      );
      if (!review) fail("NOT_FOUND", "Review not found.");
      if (review.reviewerId !== actor.userId)
        fail("FORBIDDEN", "Only the assigned reviewer can decide this review.");
      if (review.status !== "pending")
        fail("CONFLICT", "This review has already been decided.");
      for (const entry of review.documents) {
        const doc = accessibleDocument(state, actor, entry.documentId);
        if (
          doc.currentVersionId !== entry.versionId ||
          doc.officeWebUrl !== entry.officeWebUrl
        )
          fail(
            "CONFLICT",
            "A document changed after this review began. Request a new review for the current versions.",
          );
      }
      review.status = action.decision;
      review.comment = action.comment ?? "";
      review.resolvedAt = now;
      for (const entry of review.documents) {
        const doc = state.documents.find(
          (item) => item.id === entry.documentId,
        )!;
        doc.status = action.decision === "approved" ? "approved" : "draft";
        doc.updatedAt = now;
      }
      resultId = review.id;
      detail = `Review ${action.decision}: ${review.title}`;
      break;
    }
    case "createTransmittal": {
      const id = randomUUID();
      const documents = snapshot(state, actor, action.documentIds);
      if (documents.some((doc) => !doc.versionId || doc.officeWebUrl))
        fail(
          "BAD_REQUEST",
          "Upload an exported Office revision before recording a transmittal. A live Office link does not freeze the issued version.",
        );
      state.transmittals.push({
        id,
        title: action.title,
        documents,
        recipients: action.recipients,
        message: action.message ?? "",
        createdBy: actor.userId,
        createdAt: now,
      });
      resultId = id;
      detail = `Recorded transmittal: ${action.title}`;
      break;
    }
    default: {
      const doc = accessibleDocument(state, actor, action.documentId, {
        write: action.action !== "comment",
        allowDeleted: action.action === "restore",
        ignoreLock: action.action === "unlock",
      });
      resultId = auditDocument = doc.id;
      auditFolder = doc.folderId;
      switch (action.action) {
        case "updateDocument": {
          const target =
            action.folderId === undefined ? doc.folderId : action.folderId;
          assertFolderRole(state, actor, target, "editor");
          siblingName(state, action.name ?? doc.name, target, doc.id);
          if (action.status === "approved" && doc.status !== "approved")
            fail(
              "BAD_REQUEST",
              "Use an assigned review to approve a document.",
            );
          doc.folderId = target;
          doc.name = action.name ?? doc.name;
          doc.description = action.description ?? doc.description;
          doc.tags = action.tags ? [...new Set(action.tags)] : doc.tags;
          doc.status = action.status ?? doc.status;
          detail = `Updated ${doc.name}`;
          break;
        }
        case "delete":
          supersedeReviews(state, doc.id);
          doc.deletedAt = now;
          detail = `Moved ${doc.name} to recycle bin`;
          break;
        case "restore":
          siblingName(state, doc.name, doc.folderId, doc.id);
          doc.deletedAt = null;
          detail = `Restored ${doc.name}`;
          break;
        case "lock":
          doc.lockedBy = actor.userId;
          detail = `Locked ${doc.name}`;
          break;
        case "unlock":
          if (
            doc.lockedBy &&
            doc.lockedBy !== actor.userId &&
            assertFolderRole(state, actor, doc.folderId) !== "manager"
          )
            fail(
              "FORBIDDEN",
              "Only the lock owner or a folder manager can unlock this document.",
            );
          doc.lockedBy = null;
          detail = `Unlocked ${doc.name}`;
          break;
        case "copy": {
          const copy = newDocument(
            state,
            actor,
            action.name ??
              `${doc.name.replace(/(\.[^.]+)$/, "").slice(0, 175)} (copy)${/\.[^.]+$/.exec(doc.name)?.[0]?.slice(0, 16) ?? ""}`,
            action.folderId === undefined ? doc.folderId : action.folderId,
            doc.officeWebUrl,
          );
          copy.description = doc.description;
          copy.tags = [...doc.tags];
          if (doc.currentVersionId) {
            const original = state.versions.find(
              (version) => version.id === doc.currentVersionId,
            )!;
            const version = {
              ...original,
              id: randomUUID(),
              documentId: copy.id,
              number: 1,
              createdBy: actor.userId,
              createdAt: now,
              restoredFromVersionId: original.id,
            };
            state.versions.push(version);
            copy.currentVersionId = version.id;
          }
          resultId = auditDocument = copy.id;
          detail = `Copied ${doc.name}`;
          break;
        }
        case "restoreVersion": {
          const original = state.versions.find(
            (version) =>
              version.id === action.versionId && version.documentId === doc.id,
          );
          if (!original) fail("NOT_FOUND", "Version not found.");
          const version = {
            ...original,
            id: randomUUID(),
            number:
              state.versions.filter((entry) => entry.documentId === doc.id)
                .length + 1,
            createdBy: actor.userId,
            createdAt: now,
            restoredFromVersionId: original.id,
          };
          state.versions.push(version);
          doc.currentVersionId = version.id;
          doc.status = "draft";
          supersedeReviews(state, doc.id);
          detail = `Restored version ${original.number} as version ${version.number}`;
          break;
        }
        case "comment": {
          const comment = {
            id: randomUUID(),
            documentId: doc.id,
            body: action.body,
            createdBy: actor.userId,
            createdAt: now,
          };
          state.comments.push(comment);
          resultId = comment.id;
          detail = "Added comment";
          break;
        }
      }
      doc.updatedAt = now;
    }
  }
  audit(state, actor, action.action, detail, auditDocument, auditFolder);
  assertStateBounds(state);
  return { id: resultId };
}

export function visibleState(
  state: DocumentState,
  actor: DocumentActor,
): DocumentState {
  const folders = state.folders
    .filter((folder) => folderRole(state, actor, folder.id))
    .map((folder) => ({
      ...folder,
      permissions:
        folderRole(state, actor, folder.id) === "manager"
          ? folder.permissions
          : [],
      canWrite: folderRole(state, actor, folder.id) !== "viewer",
      canManage: folderRole(state, actor, folder.id) === "manager",
    }));
  const documents = state.documents
    .filter(
      (doc) =>
        doc.jobId === actor.jobId &&
        folderRole(state, actor, doc.folderId) &&
        (!doc.deletedAt || folderRole(state, actor, doc.folderId) !== "viewer"),
    )
    .map((doc) => ({
      ...doc,
      canWrite: folderRole(state, actor, doc.folderId) !== "viewer",
      canManage: folderRole(state, actor, doc.folderId) === "manager",
    }));
  const ids = new Set(documents.map((doc) => doc.id));
  const activeIds = new Set(
    documents.filter((doc) => !doc.deletedAt).map((doc) => doc.id),
  );
  const folderIds = new Set(folders.map((folder) => folder.id));
  // Explicit child grants need a navigable root without exposing hidden ancestor metadata.
  for (const folder of folders)
    if (folder.parentId && !folderIds.has(folder.parentId))
      folder.parentId = null;
  return {
    schemaVersion: 1,
    folders,
    documents,
    versions: state.versions.filter((version) => ids.has(version.documentId)),
    comments: state.comments.filter((comment) => ids.has(comment.documentId)),
    activity: state.activity.filter((event) =>
      event.documentId
        ? ids.has(event.documentId)
        : event.folderId
          ? folderIds.has(event.folderId)
          : actor.canManage || event.createdBy === actor.userId,
    ),
    reviews: state.reviews.filter((review) =>
      review.documents.every((doc) => activeIds.has(doc.documentId)),
    ),
    transmittals: state.transmittals.filter((transmittal) =>
      transmittal.documents.every((doc) => activeIds.has(doc.documentId)),
    ),
  };
}
