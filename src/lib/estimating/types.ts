import { z } from "zod";

export const estimateStatusSchema = z.enum([
  "draft",
  "in_review",
  "approved",
  "sent",
  "won",
  "lost",
  "archived",
]);
export type EstimateStatus = z.infer<typeof estimateStatusSchema>;
const amount = z.number().finite().min(0).max(100_000_000);
const percent = z.number().finite().min(0).max(1000);
export const estimatingSettingsSchema = z.object({
  currency: z.enum(["CAD", "USD", "GBP", "EUR"]).default("CAD"),
  laborRate: amount.default(85),
  laborBurdenPercent: percent.default(0),
  productivityFactor: z.number().finite().min(0.01).max(100).default(1),
  overheadPercent: percent.default(10),
  contingencyPercent: percent.default(5),
  profitMode: z.enum(["markup", "margin"]).default("margin"),
  profitPercent: z.number().finite().min(0).max(95).default(15),
  taxPercent: percent.default(0),
  taxBasis: z.enum(["all", "materials"]).default("all"),
});
export type EstimatingSettings = z.infer<typeof estimatingSettingsSchema>;
export const estimateSourceSchema = z.object({
  kind: z.enum([
    "manual",
    "catalogue",
    "material-list",
    "drawing-measurement",
    "drawing-schedule",
    "room",
    "assembly",
    "ai",
  ]),
  sheetId: z.string().optional(),
  markupId: z.string().optional(),
  floorId: z.string().optional(),
  label: z.string().max(300).optional(),
  revision: z.string().max(100).optional(),
  fingerprint: z.string().max(300).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.string().max(2000).optional(),
});
export const estimateLineSchema = z.object({
  id: z.string().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  quantity: amount,
  unit: z.string().trim().min(1).max(30).default("ea"),
  multiplier: z.number().finite().min(0).max(10000).default(1),
  wastePercent: percent.default(0),
  orderMultiple: z
    .number()
    .finite()
    .min(0)
    .max(999999)
    .nullable()
    .default(null),
  materialUnitCost: amount.nullable().default(null),
  laborHoursPerUnit: amount.default(0),
  laborRate: amount.nullable().default(null),
  equipmentUnitCost: amount.default(0),
  subcontractUnitCost: amount.default(0),
  otherUnitCost: amount.default(0),
  trade: z.string().max(100).default("General"),
  costCode: z.string().max(100).default(""),
  area: z.string().max(200).default(""),
  phase: z.string().max(100).default(""),
  supplierName: z.string().max(200).default(""),
  partDefinitionId: z.string().optional(),
  supplierPartId: z.string().optional(),
  priceSource: z
    .enum(["manual", "supplier", "imported", "simulated", "missing"])
    .default("missing"),
  priceCurrency: z.enum(["CAD", "USD", "GBP", "EUR"]).optional(),
  priceRowId: z.string().max(100).optional(),
  priceUpdatedAt: z.string().optional(),
  reviewStatus: z
    .enum(["unreviewed", "approved", "excluded"])
    .default("unreviewed"),
  alternateId: z.string().max(100).nullable().default(null),
  source: estimateSourceSchema.default({ kind: "manual" }),
  notes: z.string().max(4000).default(""),
});
export type EstimateLine = z.infer<typeof estimateLineSchema>;
export const estimateDocumentSchema = z.object({
  version: z.literal(1).default(1),
  settings: estimatingSettingsSchema.default(() =>
    estimatingSettingsSchema.parse({}),
  ),
  lines: z.array(estimateLineSchema).max(2000).default([]),
  alternates: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        name: z.string().trim().min(1).max(200),
        included: z.boolean().default(false),
      }),
    )
    .max(100)
    .default([]),
  selectedSheetIds: z.array(z.string().uuid()).max(500).default([]),
  scope: z.string().max(20000).default(""),
  inclusions: z.string().max(20000).default(""),
  exclusions: z.string().max(20000).default(""),
  assumptions: z.string().max(20000).default(""),
  customerName: z.string().max(300).default(""),
  customerEmail: z.string().max(300).default(""),
  validUntil: z.string().max(30).default(""),
  notes: z.string().max(20000).default(""),
});
export type EstimateDocument = z.infer<typeof estimateDocumentSchema>;
export const pricingRowSchema = z.object({
  id: z.string().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  sku: z.string().max(200).default(""),
  unit: z.string().max(30).default("ea"),
  materialUnitCost: amount.nullable().default(null),
  laborHoursPerUnit: amount.default(0),
  equipmentUnitCost: amount.default(0),
  subcontractUnitCost: amount.default(0),
  otherUnitCost: amount.default(0),
  orderMultiple: z
    .number()
    .finite()
    .min(0)
    .max(999999)
    .nullable()
    .default(null),
  supplierName: z.string().max(200).default(""),
  trade: z.string().max(100).default("General"),
  costCode: z.string().max(100).default(""),
  updatedAt: z.string().max(40).optional(),
  currency: z.enum(["CAD", "USD", "GBP", "EUR"]).optional(),
  priceSource: z
    .enum(["manual", "supplier", "imported", "simulated", "missing"])
    .optional(),
});
export type PricingRow = z.infer<typeof pricingRowSchema>;
export const assemblySchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  unit: z.string().max(30).default("ea"),
  description: z.string().max(4000).default(""),
  lines: z.array(estimateLineSchema).min(1).max(300),
});
export type EstimateAssembly = z.infer<typeof assemblySchema>;
export type EstimateRecord = {
  id: string;
  jobId: string;
  jobName: string;
  name: string;
  status: EstimateStatus;
  revision: number;
  document: EstimateDocument;
  createdAt: Date | string;
  updatedAt: Date | string;
  createdByName?: string | null;
  companyName?: string | null;
};
export type EstimateSummary = {
  currency: EstimatingSettings["currency"];
  total: number;
  directCost: number;
  materialTotal: number;
  laborTotal: number;
  laborHours: number;
  lineCount: number;
  readiness: {
    ready: boolean;
    score: number;
    unreviewed: number;
    missingPrices: number;
    simulatedPrices: number;
  };
};
export type EstimateListRecord = Omit<EstimateRecord, "document"> & {
  summary: EstimateSummary;
};
export type EstimateHistoryEntry = {
  id: string;
  revision: number;
  name: string;
  status: EstimateStatus;
  summary: EstimateSummary;
  actorName: string;
  actorId: string;
  effectiveUserId: string;
  effectiveUserName: string;
  simulationId: string | null;
  createdAt: Date | string;
  action: string;
};
export const newEstimateDocument = () => estimateDocumentSchema.parse({});
export const newEstimateLine = (
  values: Partial<EstimateLine> &
    Pick<EstimateLine, "description" | "quantity">,
): EstimateLine =>
  estimateLineSchema.parse({ id: crypto.randomUUID(), ...values });
