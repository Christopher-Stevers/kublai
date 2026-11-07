import { duplicateEvidence } from "~/lib/receiving-review";
import type { DocumentState, JobDocument } from "~/server/documents/types";

// Deleted receipts still protect against receiving the same delivery twice.
const hasReceipt = (doc: JobDocument) =>
  !!doc.packingSlipAnalysis?.applied ||
  !!doc.receivingReview?.lines.some((line) => line.approved);

export function duplicateList(state: DocumentState, doc: JobDocument) {
  const hash =
    state.versions.find((v) => v.id === doc.currentVersionId)?.sha256 ?? "";
  return state.documents
    .filter((d) => d.id !== doc.id && (!d.deletedAt || hasReceipt(d)))
    .flatMap((other) => {
      if (
        other.receivingReview?.retiredBy === doc.id ||
        doc.receivingReview?.replaces === other.id
      )
        return [];
      const reason = duplicateEvidence(
        {
          hash,
          review: doc.receivingReview,
          analysis: doc.packingSlipAnalysis,
          orderId: doc.packingSlip?.orderId,
        },
        {
          hash:
            state.versions.find((v) => v.id === other.currentVersionId)
              ?.sha256 ?? "",
          review: other.receivingReview,
          analysis: other.packingSlipAnalysis,
          orderId: other.packingSlip?.orderId,
        },
      );
      return reason
        ? [
            {
              id: other.id,
              name: other.name,
              versionId: other.currentVersionId,
              reason,
              received:
                hasReceipt(other),
              key: `${other.id}:${other.currentVersionId}`,
            },
          ]
        : [];
    });
}
