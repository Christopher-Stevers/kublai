/** Earned trust: once a person has checked a supplier's slips and changed
 * nothing on enough of them in a row, its next slips the reader is sure of
 * are received without a check, and the person who scanned one is told so
 * with a way to undo it. Trust comes from the confirmation records already
 * kept for review, so nothing new is stored. Off unless the organization is
 * listed in PACKING_SLIP_AUTOPILOT_ORGANIZATIONS. */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { chatPushSubscriptions } from "~/server/db/chat-push-schema";
import {
  orders,
  packingSlipReviewHistory,
  suppliers,
} from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";
import { documentActor, type DocumentAccess } from "~/server/documents/access";
import { accessibleDocument } from "~/server/documents/domain";
import { readWorkspace } from "~/server/documents/service";
import { getPushConfiguration } from "~/server/chat/push";
import { sendPushPayload } from "~/server/chat/push-transport";
import {
  autopilotBlockers,
  slipOutcome,
  supplierTrust,
  type ConfirmationEntry,
  type SlipOutcome,
} from "~/lib/slip-autopilot";
import {
  receiveWithoutCheck,
  receivingOrderCandidates,
} from "./receiving-service";
import { orderSnapshot } from "./service";

export function autopilotEnabled(organizationId: string) {
  return (process.env.PACKING_SLIP_AUTOPILOT_ORGANIZATIONS ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(organizationId);
}

/** The supplier's latest received slips, newest first. */
export async function supplierOutcomes(
  organizationId: string,
  supplierId: string,
): Promise<SlipOutcome[]> {
  const supplierOrders = (
    await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.supplierId, supplierId),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(500)
  ).map((o) => o.id);
  if (!supplierOrders.length) return [];
  const h = packingSlipReviewHistory;
  const confirmations = and(
    eq(h.organizationId, organizationId),
    eq(h.kind, "confirmation"),
  );
  const last = sql<string>`max(${h.createdAt})`;
  const received = await db
    .select({ documentId: h.documentId, at: last })
    .from(h)
    .where(
      and(
        confirmations,
        sql`${h.data}->>'operation' = 'approve'`,
        inArray(sql`${h.data}->'packingSlip'->>'orderId'`, supplierOrders),
      ),
    )
    .groupBy(h.documentId)
    .orderBy(desc(last))
    .limit(30);
  if (!received.length) return [];
  // Every confirmation of those slips, so a correction before or after the
  // receipt counts. Only what is needed: the saved source text is large.
  const review = (side: "before" | "after") =>
    sql`jsonb_build_object('kind', ${h.data}->${side}->'kind', 'lines', ${h.data}->${side}->'lines')`;
  const rows = await db
    .select({
      documentId: h.documentId,
      operation: sql<string>`${h.data}->>'operation'`,
      initiator: sql<string | null>`${h.data}->>'initiator'`,
      before: review("before"),
      after: review("after"),
    })
    .from(h)
    .where(
      and(
        confirmations,
        inArray(
          h.documentId,
          received.map((r) => r.documentId),
        ),
      ),
    )
    .orderBy(h.createdAt);
  return received.flatMap((r) => {
    const outcome = slipOutcome(
      rows.filter(
        (row) => row.documentId === r.documentId,
      ) as ConfirmationEntry[],
    );
    return outcome ? [outcome] : [];
  });
}

/** Receives a freshly read slip without a check when every rule holds and
 * its supplier has earned it. Says why not otherwise; never throws. */
export async function receiveIfTrusted(
  access: DocumentAccess,
  documentId: string,
): Promise<{ received: boolean; why?: string }> {
  if (!autopilotEnabled(access.job.organizationId))
    return { received: false, why: "off" };
  if (!userCan(access.user, "orders.receive"))
    return { received: false, why: "no permission" };
  try {
    const state = await readWorkspace(access);
    const doc = accessibleDocument(
      state,
      documentActor(access, []),
      documentId,
    );
    const review = doc.receivingReview;
    const orderId = doc.packingSlip?.orderId;
    if (!review || !orderId) return { received: false, why: "no order" };
    const [order] = await db
      .select({ supplierId: orders.supplierId, number: orders.orderNumber })
      .from(orders)
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.organizationId, access.job.organizationId),
        ),
      )
      .limit(1);
    if (!order?.supplierId) return { received: false, why: "no supplier" };
    const [best] = await receivingOrderCandidates(access, documentId);
    const blockers = autopilotBlockers({
      review,
      analysis: doc.packingSlipAnalysis,
      currentVersionId: doc.currentVersionId,
      items: await orderSnapshot(db, access, orderId),
      orderId,
      best,
    });
    if (blockers.length) return { received: false, why: blockers.join(", ") };
    const trust = supplierTrust(
      await supplierOutcomes(access.job.organizationId, order.supplierId),
    );
    if (!trust.trusted)
      return {
        received: false,
        why: trust.due ? "one in ten is checked" : "not trusted yet",
      };
    await receiveWithoutCheck(access, documentId, {
      supplierId: order.supplierId,
      best,
      trustedAfter: trust.checked,
    });
    await tellScanner(access, documentId, {
      order: doc.packingSlip?.orderNumber ?? order.number ?? "The order",
      supplierId: order.supplierId,
      lines: review.lines.length,
    }).catch(() => undefined);
    return { received: true };
  } catch (error) {
    // Only this app's own messages: a database error may quote the slip.
    return {
      received: false,
      why: error instanceof TRPCError ? error.message.slice(0, 200) : "failed",
    };
  }
}

/** "PO-155 received from Wolseley, 24 lines", to each device of the person
 * who scanned it. Best effort: the review says the same. */
async function tellScanner(
  access: DocumentAccess,
  documentId: string,
  slip: { order: string; supplierId: string; lines: number },
) {
  const configuration = getPushConfiguration();
  if (!configuration) return;
  const [supplier] = await db
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, slip.supplierId),
        eq(suppliers.organizationId, access.job.organizationId),
      ),
    )
    .limit(1);
  const devices = await db
    .select({
      endpoint: chatPushSubscriptions.endpoint,
      p256dh: chatPushSubscriptions.p256dh,
      auth: chatPushSubscriptions.auth,
    })
    .from(chatPushSubscriptions)
    .where(eq(chatPushSubscriptions.userId, access.user.id));
  const payload = slipReceivedPayload(
    access.job.id,
    documentId,
    access.user.id,
    `${slip.order} received${supplier?.name ? ` from ${supplier.name}` : ""}`,
    `${slip.lines} line${slip.lines === 1 ? "" : "s"}, received without a check. Open it to look or undo.`,
  );
  await Promise.allSettled(
    devices.map((device) =>
      sendPushPayload(
        { ...device, recipientId: access.user.id },
        configuration,
        payload,
      ),
    ),
  );
}

export function slipReceivedPayload(
  jobId: string,
  documentId: string,
  recipientId: string,
  title: string,
  body: string,
) {
  return JSON.stringify({
    type: "slip-received",
    url: `/jobs/${jobId}/receiving?document=${documentId}`,
    account: createHash("sha256").update(recipientId).digest("hex"),
    tag: `slip-received-${documentId}`,
    title,
    body,
  });
}
