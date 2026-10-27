import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { jobDocumentWorkspaces } from "~/server/db/schema";
import type { mutateWorkspace } from "~/server/documents/service";
type Tx = Parameters<Parameters<typeof mutateWorkspace>[2]>[3];
/** Share the receiving job lock, before taking order/item locks. */
export async function assertManualReceiptEditable(
  tx: Tx,
  organizationId: string,
  jobId: string | null,
  orderId: string,
  itemId?: string,
) {
  if (!jobId) return;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${jobId}, 4149))`,
  );
  const [workspace] = await tx
    .select({ state: jobDocumentWorkspaces.state })
    .from(jobDocumentWorkspaces)
    .where(
      and(
        eq(jobDocumentWorkspaces.organizationId, organizationId),
        eq(jobDocumentWorkspaces.jobId, jobId),
      ),
    )
    .limit(1);
  const approved = workspace?.state.documents.some(
    (d) =>
      d.packingSlip?.orderId === orderId &&
      (!!d.receivingReview?.lines.some(
        (l) => l.approved && (!itemId || l.approved.itemId === itemId),
      ) ||
        (d.packingSlipAnalysis?.applied &&
          (!itemId || itemId in d.packingSlipAnalysis.applied.quantities))),
  );
  if (approved)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This order has approved packing-slip receipts. Use the receiving review queue to correct quantities so its receipt history stays accurate.",
    });
}
