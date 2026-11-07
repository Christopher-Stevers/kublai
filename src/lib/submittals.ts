import type {
  DocumentOverview,
  DocumentReview,
  JobDocument,
  SubmittalInput,
} from "~/server/documents/types";

export type SubmittalStatus = "uploaded" | "pending" | "approved" | "changes";
export const submittalStatuses: Record<
  SubmittalStatus,
  { label: string; className: string }
> = {
  uploaded: {
    label: "Uploaded",
    className:
      "border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  pending: {
    label: "Pending approval",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  approved: {
    label: "Approved",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  },
  changes: {
    label: "Changes requested",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300",
  },
};
export function submittalTitle(filename: string) {
  return (
    filename
      .replace(/\.pdf$/i, "")
      .replace(/[_]+/g, " ")
      .trim()
      .slice(0, 200) || "Untitled submittal"
  );
}
export function defaultSubmittal(filename: string): SubmittalInput {
  return {
    title: submittalTitle(filename),
    category: "",
    specSection: "",
    manufacturer: "",
    dueDate: null,
  };
}
export function currentSubmittalReview(
  document: JobDocument,
  reviews: DocumentReview[],
) {
  return reviews
    .slice()
    .reverse()
    .filter(
      (review) =>
        review.status !== "superseded" &&
        review.documents.some(
          (entry) =>
            entry.documentId === document.id &&
            entry.versionId === document.currentVersionId,
        ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
export function submittalStatus(
  document: JobDocument,
  reviews: DocumentReview[],
): SubmittalStatus {
  const status = currentSubmittalReview(document, reviews)?.status;
  return status === "pending"
    ? "pending"
    : status === "approved"
      ? "approved"
      : status === "changes_requested"
        ? "changes"
        : "uploaded";
}
export function needsSubmittalReview(
  document: JobDocument,
  data: DocumentOverview,
) {
  const review = currentSubmittalReview(document, data.reviews);
  return (
    (review?.status === "pending" &&
      review.reviewerId === data.capabilities.userId) ||
    (review?.status === "changes_requested" &&
      (Boolean(document.canWrite) ||
        document.createdBy === data.capabilities.userId))
  );
}
export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function submittalOverdue(
  document: JobDocument,
  reviews: DocumentReview[],
  today = localDateKey(),
) {
  return Boolean(
    document.submittal?.dueDate &&
    document.submittal.dueDate < today &&
    submittalStatus(document, reviews) !== "approved",
  );
}
export function submittalDueLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
/** Index once per workspace refresh, so filtering never rescans the full review history. */
export function submittalRegister(
  data: DocumentOverview,
  today = localDateKey(),
) {
  const documents = data.documents.filter(
    (doc) => doc.submittal && !doc.deletedAt,
  );
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const versions = new Map(
    data.versions.map((version) => [version.id, version]),
  );
  const reviews = new Map<string, DocumentReview>();
  for (const review of data.reviews) {
    if (review.status === "superseded") continue;
    for (const snapshot of review.documents) {
      const doc = byId.get(snapshot.documentId);
      if (!doc?.currentVersionId || snapshot.versionId !== doc.currentVersionId)
        continue;
      const previous = reviews.get(doc.id);
      if (!previous || previous.createdAt <= review.createdAt)
        reviews.set(doc.id, review);
    }
  }
  return documents
    .map((document) => {
      const review = reviews.get(document.id);
      const history = review ? [review] : [];
      const status = submittalStatus(document, history);
      const mine = needsSubmittalReview(document, {
        ...data,
        reviews: history,
      });
      const overdue = submittalOverdue(document, history, today);
      const priority =
        review?.status === "pending" && mine
          ? 0
          : status === "changes"
            ? 1
            : overdue
              ? 2
              : status === "approved"
                ? 4
                : 3;
      const info = document.submittal!;
      return {
        document,
        review,
        status,
        mine,
        overdue,
        priority,
        version: versions.get(document.currentVersionId ?? ""),
        search:
          `${info.number} ${info.title} ${info.category} ${info.specSection} ${info.manufacturer} ${document.name}`.toLocaleLowerCase(),
      };
    })
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        b.document.updatedAt.localeCompare(a.document.updatedAt) ||
        a.document.submittal!.number.localeCompare(
          b.document.submittal!.number,
          undefined,
          { numeric: true },
        ),
    );
}
