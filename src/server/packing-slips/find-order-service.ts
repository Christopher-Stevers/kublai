import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  notInArray,
  or,
  isNull,
  ne,
} from "drizzle-orm";
import { db } from "~/server/db";
import {
  materialLists,
  orderItems,
  orders,
  partDefinitions,
  partSynonyms,
  supplierParts,
  suppliers,
} from "~/server/db/schema";
import { userCan } from "~/server/auth/permissions";
import { documentActor, type DocumentAccess } from "~/server/documents/access";
import { accessibleDocument } from "~/server/documents/domain";
import { readWorkspace } from "~/server/documents/service";
import { extractSlip } from "./extract";
import { askWhichOrder, findOrder, type SlipOrder } from "./find-order";
import { askJev, type VisionAsk } from "./vision";

export type OrderOption = {
  id: string;
  orderNumber: string;
  supplier: string | null;
  materialListId: string;
  materialListName: string;
  sentAt: string | null;
  received: boolean;
};
/** Jev's pick is taken without asking at this confidence, when the OCR found
 * at least one of the order's products on the slip. A wrong pick in testing
 * had none. */
const JEV_PICK = 0.85;

/** The job's sent, active orders with the products on them. */
export async function jobOrders(access: DocumentAccess) {
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      supplier: suppliers.name,
      materialListId: orders.materialListId,
      materialListName: materialLists.name,
      sentAt: orders.sentAt,
    })
    .from(orders)
    .innerJoin(
      materialLists,
      and(
        eq(materialLists.id, orders.materialListId),
        eq(materialLists.jobId, access.job.id),
      ),
    )
    .leftJoin(suppliers, eq(suppliers.id, orders.supplierId))
    .where(
      and(
        eq(orders.jobId, access.job.id),
        eq(orders.organizationId, access.job.organizationId),
        isNotNull(orders.materialListId),
        notInArray(orders.status, ["draft", "cancelled"]),
        or(
          isNull(orders.fulfillmentStatus),
          ne(orders.fulfillmentStatus, "cancelled"),
        ),
      ),
    )
    .orderBy(desc(orders.sentAt))
    .limit(2000);
  if (!rows.length) return [];
  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      partId: orderItems.partDefinitionId,
      description: orderItems.descriptionSnapshot,
      displayName: partDefinitions.displayName,
      sku: orderItems.supplierSkuSnapshot,
      currentSku: supplierParts.supplierSku,
      supplierDescription: supplierParts.supplierName,
      quantity: orderItems.quantity,
      received: orderItems.receivedQuantity,
      verificationStatus: orderItems.verificationStatus,
    })
    .from(orderItems)
    .innerJoin(
      partDefinitions,
      and(
        eq(partDefinitions.id, orderItems.partDefinitionId),
        eq(partDefinitions.organizationId, access.job.organizationId),
      ),
    )
    .leftJoin(
      supplierParts,
      and(
        eq(supplierParts.id, orderItems.supplierPartId),
        eq(supplierParts.organizationId, access.job.organizationId),
      ),
    )
    .where(
      inArray(
        orderItems.orderId,
        rows.map((r) => r.id),
      ),
    );
  const aliases = items.length
    ? await db
        .select({
          partId: partSynonyms.partDefinitionId,
          synonym: partSynonyms.synonym,
        })
        .from(partSynonyms)
        .where(
          inArray(partSynonyms.partDefinitionId, [
            ...new Set(items.map((i) => i.partId)),
          ]),
        )
    : [];
  return rows.map((r) => {
    const own = items.filter((i) => i.orderId === r.id);
    return {
      option: {
        id: r.id,
        orderNumber: r.orderNumber?.trim()
          ? r.orderNumber.trim()
          : `Order ${r.id.slice(0, 8)}`,
        supplier: r.supplier,
        materialListId: r.materialListId!,
        materialListName: r.materialListName ?? "Material list",
        sentAt: r.sentAt?.toISOString() ?? null,
        received:
          own.length > 0 &&
          own.every((i) => Number(i.received) >= Number(i.quantity)),
      } satisfies OrderOption,
      slip: {
        id: r.id,
        orderNumber: r.orderNumber ?? "",
        supplier: r.supplier,
        items: own.map((i) => ({
          id: i.id,
          description: i.description?.trim() ? i.description : i.displayName,
          sku: i.sku?.trim() ? i.sku : i.currentSku,
          aliases: [
            ...(i.supplierDescription ? [i.supplierDescription] : []),
            ...aliases
              .filter((a) => a.partId === i.partId)
              .map((a) => a.synonym),
          ].slice(0, 20),
          ordered: Number(i.quantity),
          received: Number(i.received),
          verificationStatus: i.verificationStatus,
          unit: "ea",
          piecesPerPack: null,
          individualUnit: null,
        })),
      } satisfies SlipOrder,
    };
  });
}

let running = 0;
/** Reads a saved slip and works out which of the job's orders it delivers.
 * `match` is set only when the slip clearly fits one order; `candidates` are
 * the closest orders, best first. The OCR is kept briefly, so the full reading
 * that follows does not repeat it. */
export async function identifySlipOrder(
  access: DocumentAccess,
  documentId: string,
  ask: VisionAsk = askJev,
) {
  if (!userCan(access.user, "orders.receive"))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Order receiving permission is required.",
    });
  const state = await readWorkspace(access);
  const doc = accessibleDocument(state, documentActor(access, []), documentId);
  const version = state.versions.find((v) => v.id === doc.currentVersionId);
  if (!version)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Packing slip file unavailable.",
    });
  const found = await jobOrders(access);
  const orderOptions = found.map((o) => o.option);
  if (!found.length)
    return { documentId, match: null, candidates: [], orders: orderOptions };
  // The slip stays saved; on a failed reading the member picks the order.
  if (running >= 2)
    return {
      documentId,
      match: null,
      candidates: [],
      orders: orderOptions,
      readError: "Slip reading is busy, so choose the order below.",
    };
  running++;
  try {
    const extracted = await extractSlip(
      access.job.organizationId,
      version.sha256,
      version.mimeType,
    ).catch(() => null);
    if (!extracted)
      return {
        documentId,
        match: null,
        candidates: [],
        orders: orderOptions,
        readError: "This slip could not be read, so choose the order below.",
      };
    const slips = found.map((o) => o.slip);
    const { ranked, confident } = findOrder(extracted.rows, slips);
    let match = confident ? ranked[0]!.orderId : null;
    let pick: string | null = null;
    if (!match && extracted.pages[0]) {
      const closest = ranked
        .slice(0, 6)
        .map((r) => slips.find((s) => s.id === r.orderId)!);
      const answer = await askWhichOrder(
        extracted.pages[0],
        closest,
        ask,
      ).catch(() => null);
      pick = answer?.orderId ?? null;
      const guess = ranked.find((r) => r.orderId === pick);
      if (answer && guess && answer.confidence >= JEV_PICK && guess.found >= 2 && guess.score >= 0.9 && guess.score - (ranked.find(r=>r.orderId!==pick)?.score??0) >= 0.3)
        match = pick;
    }
    const candidates = [
      ...new Set([
        ...(pick ? [pick] : []),
        ...ranked.filter((r) => r.score > 0).map((r) => r.orderId),
      ]),
    ].slice(0, 4);
    return { documentId, match, candidates, orders: orderOptions };
  } finally {
    running--;
  }
}
