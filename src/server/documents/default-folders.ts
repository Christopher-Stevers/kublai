import { createHash } from "node:crypto";
import { DEFAULT_DOCUMENT_FOLDERS } from "~/lib/default-document-folders";
import type { DocumentState } from "./types";

/** Stable IDs let brand-new jobs open default folders before their first write. */
export function ensureDefaultDocumentFolders(state: DocumentState, jobId: string, userId: string) {
  for (const name of DEFAULT_DOCUMENT_FOLDERS) {
    if (state.folders.some(f => f.parentId === null && f.name.trim().toLowerCase() === name.toLowerCase())) continue;
    const hash = createHash("sha256").update(`job-document-folder:${jobId}:${name}`).digest("hex");
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    state.folders.push({ id, name, parentId: null, permissions: [], createdBy: userId,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
  }
  return state;
}
