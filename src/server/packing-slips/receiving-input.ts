import { supplierPartLinkApproval } from "~/lib/supplier-part-link";
import { z } from "zod";
const text = z.string().trim();
const qty = z
  .number()
  .finite()
  .min(0)
  .max(999999)
  .refine(
    (n) => Math.round(n * 1e6) / 1e6 === n,
    "Use at most six decimal places.",
  );
const base = {
  jobId: z.uuid(),
  documentId: z.uuid(),
  revision: z.number().int().nonnegative(),
  requestId: z.uuid(),
  supplierPartLinkApprovals: z.array(supplierPartLinkApproval).max(200).optional(),
};
const sourceBox = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001,
    "The source area must fit on the page.",
  );
export const receivingInput = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("detectLine"), itemId: z.uuid(), page: z.number().int().min(1).max(20), sourceBox, versionId: z.uuid() }),
  z.object({ ...base, action: z.literal("splitComparison"), lineIds: z.array(text.max(100)).min(1).max(200) }),
  z.object({
    ...base,
    action: z.literal("orderDisposition"),
    itemId: z.uuid(),
    disposition: z.enum([
      "outstanding",
      "backordered",
      "cancel-requested",
      "unresolved",
    ]),
    note: text.max(1000).default(""),
  }),
  z.object({
    ...base,
    action: z.literal("resolve"),
    materialIssue: z.enum(["shipped-mismatch", "supplier-keep", "supplier-return"]).optional(),
    lineId: text.max(100),
    evidenceFingerprint: text.max(20000),
    /** Counterpart facts shown to the reviewer; null means no counterpart was shown. */
    counterpartFingerprint: text.max(20000).nullable().optional(),
    note: text.max(1000).optional(),
    match: z.enum(["confirmed", "unresolved"]).optional(),
    specification: z
      .enum([
        "confirmed",
        "substitution-accepted",
        "substitution-rejected",
        "unresolved",
      ])
      .optional(),
    quantity: z.enum(["confirmed", "unresolved"]).optional(),
    delivery: z
      .enum(["confirmed", "short", "damaged", "wrong", "extra", "unresolved"])
      .optional(),
    siteQuantity: qty.nullable().optional(),
    acceptedQuantity: qty.nullable().optional(),
    remainder: z
      .enum(["backordered", "cancelled", "unexplained"])
      .nullable()
      .optional(),
    excess: z.enum(["accepted", "return"]).nullable().optional(),
    skipped: z.boolean().optional(),
  }),
  z.object({
    ...base,
    action: z.literal("note"),
    lineId: text.max(100),
    note: text.max(1000),
  }),
  z.object({
    ...base,
    action: z.literal("allocate"),
    lineIds: z.array(text.max(100)).min(1).max(20),
    reason: text.min(3).max(1000),
    outputs: z
      .array(
        z.object({
          description: text.min(1).max(700),
          sku: text.max(255),
          quantity: qty.refine((n) => n > 0),
          unit: text.min(1).max(32),
          orderItemId: z.uuid().nullable(),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.object({
    ...base,
    action: z.literal("undoCorrection"),
    requestIdToUndo: z.uuid(),
    reason: text.min(3).max(1000),
  }),
  z.object({
    ...base,
    action: z.literal("reopen"),
    reason: text.min(3).max(1000),
  }),
  z.object({
    ...base,
    action: z.literal("restoreLine"),
    lineId: text.max(100),
    reason: text.min(3).max(1000),
  }),
  z.object({
    ...base,
    action: z.literal("adoptSource"),
    confirmed: z.literal(true),
  }),
  z.object({
    ...base,
    action: z.literal("header"),
    kind: z.enum([
      "delivery",
      "return-replacement",
      "return-credit",
      "credit-only",
    ]),
    supplierId: z.uuid().nullable(),
    supplierName: text.max(255),
    deliveryNumber: text.max(150),
    supplierOrderNumber: text.max(150),
    deliveryDate: text.max(50),
    confirmed: z.literal(true),
    documentChecked: z.boolean().default(false),
  }),
  z.object({
    ...base,
    action: z.literal("line"),
    kind: z
      .enum(["delivery", "return-replacement", "return-credit", "credit-only"])
      .nullable()
      .optional(),
    lineId: text.max(100),
    description: text.min(1).max(700),
    sku: text.max(255),
    quantity: qty.nullable(),
    ordered: qty.nullable(),
    unit: text.max(32),
    unitPrice: z.number().finite().min(0).max(999999).nullable(),
    orderItemId: z.uuid().nullable(),
    checked: z.boolean(),
    /** Part changes the reviewer accepted so the next slip matches. */
    fit: z
      .object({
        piecesPerPack: z.number().int().min(2).max(100000).optional(),
        individualUnit: text.min(1).max(32).optional(),
        bulkUnit: text.min(1).max(32).optional(),
        supplierSku: text.min(1).max(255).optional(),
        supplierName: text.min(1).max(700).optional(),
        alias: text.min(1).max(255).optional(),
      })
      .optional(),
  }),
  z.object({
    ...base,
    action: z.literal("addLine"),
    page: z.number().int().min(1).max(20),
    sourceBox: sourceBox.optional(),
    description: text.min(1).max(700),
  }),
  z.object({
    ...base,
    action: z.literal("removeOrderItem"),
    itemId: z.uuid(),
    fingerprint: text.max(200000),
    confirmed: z.literal(true),
  }),
  z.object({
    ...base,
    action: z.literal("ignore"),
    lineId: text.max(100),
    reason: text.min(3).max(1000),
  }),
  z.object({
    ...base,
    action: z.literal("approve"),
    lineIds: z.array(text.max(100)).min(1).max(200),
    fingerprint: text.max(200000),
    reason: text.max(1000).default(""),
    allowOverDelivery: z.boolean().default(false),
    /** Counts made by hand on the order are these parts: the slip takes them
     * over instead of adding to them. */
    fromHandCount: z.boolean().default(false),
    documentChecked: z.boolean().default(false),
  }),
  /** Takes back a receipt made without a check, while nothing has changed. */
  z.object({ ...base, action: z.literal("undoAutopilot") }),
  z.object({
    ...base,
    action: z.literal("duplicate"),
    decision: z.enum(["additional", "supporting", "replace"]),
    otherDocumentId: z.uuid(),
    reason: text.min(3).max(1000),
  }),
  z.object({
    ...base,
    action: z.literal("link"),
    orderId: z.uuid(),
    confirmed: z.literal(true),
  }),
  z.object({
    ...base,
    action: z.literal("supplier"),
    name: text.min(1).max(255),
    email: text
      .max(255)
      .refine((s) => s === "" || z.email().safeParse(s).success),
    phone: text.max(80),
  }),
  z.object({
    ...base,
    action: z.literal("part"),
    lineId: text.max(100),
    partId: z.uuid().nullable(),
    name: text.min(1).max(255),
    description: text.max(4000),
    catalogId: z.uuid(),
    unit: text.min(1).max(32),
    piecesPerPack: z.number().int().min(1).max(999999).nullable(),
    individualUnit: text.max(32),
    photoUrl: text.max(2000).nullable(),
    /** Also add it to the linked order and its material list. */
    addToOrder: z.boolean().default(false),
    /** Optional order-only override; delivered quantity remains the slip count. */
    orderQuantity: qty.positive().optional(),
    /** Reviewer confirms each means one complete catalogue package/length. */
    packageUnitConfirmed: z.boolean().default(false),
  }),
  z.object({
    ...base,
    action: z.literal("reconstruct"),
    materialListId: z.uuid().nullable(),
    listName: text.min(1).max(255),
    orderNumber: text.min(1).max(100),
    lineIds: z.array(text.max(100)).max(200),
    supplierId: z.uuid().optional(),
    confirmed: z.literal(true),
  }),
  z.object({
    ...base,
    action: z.literal("extra"),
    lineId: text.max(100),
    confirmed: z.literal(true),
  }),
]);
export type ReceivingInput = z.infer<typeof receivingInput>;
