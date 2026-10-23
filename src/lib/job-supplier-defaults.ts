import { z } from "zod";
export const supplierVersionSchema = z.object({
  supplierId: z.string().uuid(),
  bookId: z.string().uuid().nullable(),
  label: z.string().min(1).max(520),
});
export type SupplierVersion = z.infer<typeof supplierVersionSchema>;
const sizeSchema = z.object({
  nominal: z.number().nonnegative(),
  unit: z.string().min(1).max(30),
  label: z.string().max(100).nullable().optional(),
});
export const supplierDefaultRuleSchema = z.object({
  id: z.string().uuid(),
  catalogId: z.string().uuid().nullable(),
  materialId: z.string().uuid().nullable(),
  categoryId: z.string().uuid().nullable(),
  size: sizeSchema.nullable(),
  supplier: supplierVersionSchema,
});
export const jobSupplierDefaultsSchema = z
  .object({
    rules: z.array(supplierDefaultRuleSchema).max(50),
    fallback: supplierVersionSchema.nullable(),
  })
  .refine((value) => value.rules.length === 0 || value.fallback !== null, {
    message: "Choose a fallback supplier.",
  })
  .refine(
    (value) =>
      new Set(value.rules.map((rule) => rule.id)).size === value.rules.length,
    { message: "Duplicate supplier rule." },
  );
export type JobSupplierDefaults = z.infer<typeof jobSupplierDefaultsSchema>;
export type SupplierDefaultRule = z.infer<typeof supplierDefaultRuleSchema>;
export type SupplierDefaultPart = {
  catalogId: string;
  materialId: string | null;
  categoryId: string | null;
  sizeNominal: string | number | null;
  sizeUnit: string | null;
  sizeLabel?: string | null;
};
export const EMPTY_SUPPLIER_DEFAULTS: JobSupplierDefaults = {
  rules: [],
  fallback: null,
};
export function matchJobSupplierDefault(
  config: JobSupplierDefaults | null | undefined,
  part: SupplierDefaultPart,
): SupplierVersion | null {
  if (!config) return null;
  return (
    config.rules.find(
      (rule) =>
        (!rule.catalogId || rule.catalogId === part.catalogId) &&
        (!rule.materialId || rule.materialId === part.materialId) &&
        (!rule.categoryId || rule.categoryId === part.categoryId) &&
        (!rule.size ||
          (part.sizeNominal !== null &&
            Math.abs(Number(part.sizeNominal) - rule.size.nominal) < 0.000001 &&
            part.sizeUnit === rule.size.unit &&
            (!rule.size.label || rule.size.label === part.sizeLabel))),
    )?.supplier ?? config.fallback
  );
}
