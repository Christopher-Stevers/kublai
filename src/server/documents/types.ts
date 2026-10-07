/** Client-safe wire types. Dates are ISO 8601 strings; binary keys never leave the server. */
export type DocumentRole = "viewer" | "editor" | "manager";
export type DocumentStatus = "draft" | "in_review" | "approved" | "superseded";
export type FolderPermission = { userId: string; role: DocumentRole };
export type DocumentFolder = {
  id: string;
  parentId: string | null;
  name: string;
  permissions: FolderPermission[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  canWrite?: boolean;
  canManage?: boolean;
};
export type JobDocument = {
  id: string;
  jobId: string;
  folderId: string | null;
  name: string;
  description: string;
  tags: string[];
  status: DocumentStatus;
  currentVersionId: string | null;
  officeWebUrl: string | null;
  lockedBy: string | null;
  deletedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  canWrite?: boolean;
  canManage?: boolean;
};
export type DocumentVersion = {
  id: string;
  documentId: string;
  number: number;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  createdBy: string;
  createdAt: string;
  restoredFromVersionId: string | null;
};
export type DocumentComment = {
  id: string;
  documentId: string;
  body: string;
  createdBy: string;
  createdAt: string;
};
export type DocumentActivity = {
  id: string;
  documentId: string | null;
  folderId: string | null;
  action: string;
  detail: string;
  createdBy: string;
  createdAt: string;
};
export type DocumentSnapshot = {
  documentId: string;
  versionId: string | null;
  name: string;
  officeWebUrl: string | null;
};
export type DocumentReview = {
  id: string;
  title: string;
  documents: DocumentSnapshot[];
  reviewerId: string;
  status: "pending" | "approved" | "changes_requested" | "superseded";
  comment: string;
  createdBy: string;
  createdAt: string;
  resolvedAt: string | null;
};
export type DocumentTransmittal = {
  id: string;
  title: string;
  documents: DocumentSnapshot[];
  recipients: string[];
  message: string;
  createdBy: string;
  createdAt: string;
};
export type DocumentState = {
  schemaVersion: 1;
  folders: DocumentFolder[];
  documents: JobDocument[];
  versions: DocumentVersion[];
  comments: DocumentComment[];
  activity: DocumentActivity[];
  reviews: DocumentReview[];
  transmittals: DocumentTransmittal[];
  /** Internal transaction receipts. Never included in the document overview. */
  editorSaveReceipts?: DocumentEditorSaveReceipt[];
};
export type DocumentEditorSaveReceipt = {
  requestId: string;
  documentId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  versionId?: string;
  committedAt?: string;
  savedBy?: string;
};
export type DocumentEditorSaveStatus = {
  requestId: string;
  status: "pending" | "committed";
  versionId?: string;
  committedAt?: string;
};
export type DocumentMember = { id: string; name: string | null; email: string };
export type DocumentOverview = Omit<DocumentState, "editorSaveReceipts"> & {
  members: DocumentMember[];
  capabilities: { canManage: boolean; canWrite: boolean; userId: string };
  office: { mode: "linked"; embeddedConfigured: boolean };
};
export type DocumentAction =
  | { action: "createFolder"; name: string; parentId?: string | null }
  | {
      action: "updateFolder";
      folderId: string;
      name?: string;
      parentId?: string | null;
    }
  | {
      action: "updateDocument";
      documentId: string;
      name?: string;
      folderId?: string | null;
      description?: string;
      tags?: string[];
      status?: DocumentStatus;
    }
  | { action: "delete" | "restore" | "lock" | "unlock"; documentId: string }
  | {
      action: "copy";
      documentId: string;
      folderId?: string | null;
      name?: string;
    }
  | { action: "restoreVersion"; documentId: string; versionId: string }
  | { action: "comment"; documentId: string; body: string }
  | {
      action: "setFolderPermissions";
      folderId: string;
      permissions: FolderPermission[];
    }
  | {
      action: "createReview";
      documentIds: string[];
      title: string;
      reviewerId: string;
    }
  | {
      action: "resolveReview";
      reviewId: string;
      decision: "approved" | "changes_requested";
      comment?: string;
    }
  | {
      action: "createTransmittal";
      documentIds: string[];
      title: string;
      recipients: string[];
      message?: string;
    }
  | {
      action: "linkOffice";
      name: string;
      folderId?: string | null;
      webUrl: string;
    };

export type DocumentEditorStatus = {
  configured: boolean;
  provider: "collabora";
  reason?: string;
};
export type DocumentEditorLaunch = {
  actionUrl: string;
  wopiSrc: string;
  accessToken: string;
  /** Absolute epoch milliseconds, as required by Collabora's form field. */
  accessTokenTtl: number;
  mode: "edit" | "view";
  provider: "collabora";
  documentId: string;
  versionId: string;
};
