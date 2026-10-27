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
};
export const receivingInput = z.discriminatedUnion("action", [
  z.object({
    ...base,
    action: z.literal("trialDraft"),
    runId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
    reader: z.enum(["ocr", "jev", "terra", "astra"]),
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
    kind: z.enum(["delivery", "return-replacement", "return-credit"]),
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
      .enum(["delivery", "return-replacement", "return-credit"])
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
  }),
  z.object({
    ...base,
    action: z.literal("addLine"),
    page: z.number().int().min(1).max(20),
    description: text.min(1).max(700),
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
    documentChecked: z.boolean().default(false),
  }),
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
  }),
  z.object({
    ...base,
    action: z.literal("reconstruct"),
    materialListId: z.uuid().nullable(),
    listName: text.min(1).max(255),
    orderNumber: text.min(1).max(100),
    lineIds: z.array(text.max(100)).min(1).max(200),
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
