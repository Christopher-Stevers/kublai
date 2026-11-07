export const DEFAULT_DOCUMENT_FOLDERS = ["Submittals", "Packing Slips", "Specifications"] as const;
export function isDefaultDocumentFolder(folder: { name: string; parentId: string | null }) {
  return folder.parentId === null && DEFAULT_DOCUMENT_FOLDERS.some(name => name.toLowerCase() === folder.name.trim().toLowerCase());
}
