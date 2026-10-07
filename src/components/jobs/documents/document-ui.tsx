import { FileSpreadsheetIcon, FileTextIcon, ImageIcon } from "lucide-react";
import type {
  DocumentOverview,
  DocumentStatus,
  JobDocument,
} from "~/server/documents/types";

export const selectClass =
  "border-input bg-background h-9 min-w-0 rounded-md border px-3 text-sm";
export const textareaClass =
  "border-input bg-background min-h-24 w-full rounded-md border px-3 py-2 text-sm";
export const statusLabels: Record<DocumentStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  superseded: "Superseded",
};
export function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
export function formatBytes(size: number) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
export function memberName(data: DocumentOverview, id: string) {
  const member = data.members.find((item) => item.id === id);
  return member?.name ?? member?.email ?? "Project member";
}
export function documentKind(document: JobDocument, data: DocumentOverview) {
  const version = data.versions.find(
    (item) => item.id === document.currentVersionId,
  );
  const name = document.name.toLowerCase();
  if (/\.(xlsx?|csv|ods)$/.test(name)) return "spreadsheet";
  if (/\.(docx?|odt)$/.test(name)) return "word";
  if (version?.mimeType === "application/pdf" || name.endsWith(".pdf"))
    return "pdf";
  if (version?.mimeType.startsWith("image/")) return "image";
  return document.officeWebUrl ? "office" : "other";
}
export function DocumentIcon({
  kind,
  className = "size-5",
}: {
  kind: string;
  className?: string;
}) {
  const Icon =
    kind === "spreadsheet"
      ? FileSpreadsheetIcon
      : kind === "image"
        ? ImageIcon
        : FileTextIcon;
  return <Icon className={className} aria-hidden="true" />;
}
export function StatusBadge({ status }: { status: DocumentStatus }) {
  const color =
    status === "approved"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "in_review"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {statusLabels[status]}
    </span>
  );
}
export function versionUrl(jobId: string, versionId: string, download = false) {
  return `/api/job-documents/files/${encodeURIComponent(versionId)}?jobId=${encodeURIComponent(jobId)}${download ? "&download=1" : ""}`;
}
