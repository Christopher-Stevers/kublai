/** What earlier confirmed deliveries from the same supplier teach the reader:
 * which supplier codes are which products, whether their slips print
 * totals, and where they print the quantity columns. Derived from the
 * confirmation records already kept for review, so nothing new is stored. A code is learned only from a line the user linked
 * by hand, or whose prefilled quantity they confirmed unchanged, and only
 * when it always meant the same product. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  orderItems,
  orders,
  packingSlipReviewHistory,
} from "~/server/db/schema";
import type { db as Db } from "~/server/db";
import { normalizeSku } from "./match";
import type { LearnedColumns } from "./vision";

const confirmed = z.object({
  lines: z.array(
    z.object({
      orderItemId: z.string().nullable(),
      sku: z.string().nullable().optional(),
      proposed: z.number().nullable(),
      linked: z.literal("user").optional(),
    }),
  ),
  applied: z.object({ quantities: z.record(z.string(), z.number()) }),
  layout: z
    .object({
      footer: z.boolean(),
      // A record it cannot read loses only the columns, not the slip.
      columns: z
        .partialRecord(
          z.enum(["shipped", "ordered", "backordered"]),
          z.object({ left: z.number(), right: z.number() }),
        )
        .optional()
        .catch(undefined),
    })
    .optional(),
});
export type ConfirmedSlip = z.infer<typeof confirmed>;

/** Slips agree on a column whose middles are within this of each other. */
const AGREE = 0.02;
function median(ns: number[]) {
  const sorted = [...ns].sort((a, b) => a - b),
    half = sorted.length / 2;
  return sorted.length % 2
    ? sorted[Math.floor(half)]!
    : (sorted[half - 1]! + sorted[half]!) / 2;
}

/** Where the latest slips, newest first, printed each quantity column, once
 * two of the last three that showed it agree. One misread slip among them
 * is outvoted; a supplier that changed its form teaches nothing until two
 * of its new slips agree. */
export function learnedColumns(
  layouts: Array<NonNullable<ConfirmedSlip["layout"]>>,
): LearnedColumns | undefined {
  const out: LearnedColumns = {};
  const middle = (c: { left: number; right: number }) => (c.left + c.right) / 2;
  for (const field of ["shipped", "ordered", "backordered"] as const) {
    const seen = layouts.flatMap((l) => l.columns?.[field] ?? []).slice(0, 3);
    const agreeing = seen
      .map((c) => seen.filter((o) => Math.abs(middle(o) - middle(c)) <= AGREE))
      .sort((a, b) => b.length - a.length)[0];
    if (!agreeing || agreeing.length < 2) continue;
    out[field] = {
      left: median(agreeing.map((c) => c.left)),
      right: median(agreeing.map((c) => c.right)),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Code → order item ids it was confirmed as, from accepted lines only. */
export function acceptedCodes(slips: ConfirmedSlip[]) {
  const out: Array<{ code: string; orderItemId: string }> = [];
  for (const slip of slips) {
    const proposedTotal = new Map<string, number>();
    for (const l of slip.lines)
      if (l.orderItemId && l.proposed !== null)
        proposedTotal.set(
          l.orderItemId,
          (proposedTotal.get(l.orderItemId) ?? 0) + l.proposed,
        );
    for (const l of slip.lines) {
      const code = normalizeSku(l.sku ?? "");
      if (!l.orderItemId || code.length < 4) continue;
      const kept =
        l.linked === "user" ||
        (l.proposed !== null &&
          Math.abs(
            (slip.applied.quantities[l.orderItemId] ?? NaN) -
              proposedTotal.get(l.orderItemId)!,
          ) < 1e-6);
      if (kept) out.push({ code, orderItemId: l.orderItemId });
    }
  }
  return out;
}

/** Codes that always meant one product, grouped by that product. */
export function codesByPart(
  accepted: Array<{ code: string; orderItemId: string }>,
  partOf: Map<string, string>,
) {
  const parts = new Map<string, Set<string>>();
  for (const { code, orderItemId } of accepted) {
    const part = partOf.get(orderItemId);
    if (!part) continue;
    parts.set(code, (parts.get(code) ?? new Set()).add(part));
  }
  const byPart = new Map<string, string[]>();
  for (const [code, set] of parts)
    if (set.size === 1) {
      const part = [...set][0]!;
      byPart.set(part, [...(byPart.get(part) ?? []), code]);
    }
  return byPart;
}

export async function supplierMemory(
  db: typeof Db,
  organizationId: string,
  orderId: string,
): Promise<{
  known: Record<string, string[]>;
  expectFooter: boolean;
  columns?: LearnedColumns;
}> {
  const none = { known: {}, expectFooter: false };
  const [order] = await db
    .select({ supplierId: orders.supplierId })
    .from(orders)
    .where(
      and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)),
    )
    .limit(1);
  if (!order?.supplierId) return none;
  const supplierOrders = (
    await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.organizationId, organizationId),
          eq(orders.supplierId, order.supplierId),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(500)
  ).map((o) => o.id);
  const history = await db
    .select({
      analysis: sql<unknown>`${packingSlipReviewHistory.data}->'confirmedAnalysis'`,
    })
    .from(packingSlipReviewHistory)
    .where(
      and(
        eq(packingSlipReviewHistory.organizationId, organizationId),
        eq(packingSlipReviewHistory.kind, "confirmation"),
        inArray(
          sql`${packingSlipReviewHistory.data}->'packingSlip'->>'orderId'`,
          supplierOrders,
        ),
      ),
    )
    .orderBy(desc(packingSlipReviewHistory.createdAt))
    .limit(100);
  const slips = history.flatMap((h) => {
    const parsed = confirmed.safeParse(h.analysis);
    return parsed.success ? [parsed.data] : [];
  });
  const accepted = acceptedCodes(slips);
  const itemIds = [...new Set([...accepted.map((a) => a.orderItemId)])].slice(
    0,
    2000,
  );
  const current = await db
    .select({ id: orderItems.id, part: orderItems.partDefinitionId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const earlier = itemIds.length
    ? await db
        .select({ id: orderItems.id, part: orderItems.partDefinitionId })
        .from(orderItems)
        .innerJoin(orders, eq(orders.id, orderItems.orderId))
        .where(
          and(
            inArray(orderItems.id, itemIds),
            eq(orders.organizationId, organizationId),
          ),
        )
    : [];
  const byPart = codesByPart(
    accepted,
    new Map(earlier.map((r) => [r.id, r.part])),
  );
  const known: Record<string, string[]> = {};
  for (const item of current) {
    const codes = byPart.get(item.part);
    if (codes) known[item.id] = codes;
  }
  const layouts = slips.flatMap((s) => (s.layout ? [s.layout] : []));
  const columns = learnedColumns(layouts);
  return {
    known,
    expectFooter: layouts.length >= 2 && layouts.every((l) => l.footer),
    ...(columns ? { columns } : {}),
  };
}
