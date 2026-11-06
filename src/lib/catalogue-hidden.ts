import { z } from "zod";

/**
 * Parts the company hid from adding to material lists, to keep the crew's
 * choices short. A rule hides every part that matches all of its criteria; a
 * criterion it leaves out matches anything. The Catalogue still shows hidden
 * parts, and removing the rule offers them again.
 */
const criteriaShape = {
  catalogId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  size: z.object({ nominal: z.number(), unit: z.string().min(1).max(50) }).optional(),
  categoryId: z.string().uuid().optional(),
  partId: z.string().uuid().optional(),
};
const hidesSomething = (rule: z.infer<z.ZodObject<typeof criteriaShape>>) =>
  !!(rule.catalogId ?? rule.materialId ?? rule.size ?? rule.categoryId ?? rule.partId);
export const catalogueHideCriteriaSchema = z
  .object(criteriaShape)
  .refine(hidesSomething, "Choose at least one thing to hide.");
export const catalogueHideRuleSchema = z
  .object({ id: z.string().min(1).max(64), ...criteriaShape })
  .refine(hidesSomething);
export type CatalogueHideRule = z.infer<typeof catalogueHideRuleSchema>;
export type CatalogueHideCriteria = z.infer<typeof catalogueHideCriteriaSchema>;

export const catalogueHiddenSettingsSchema = z.object({
  rules: z.array(catalogueHideRuleSchema).max(500),
});

/** The jsonb settings store row that holds the company's rules. */
export const CATALOGUE_HIDDEN_SCOPE = "catalogue-hidden";

type HideablePart = {
  id?: string;
  catalogId: string;
  materialId: string | null;
  sizeNominal: string | number | null;
  sizeUnit: string | null;
  categoryId: string | null;
};

export function ruleMatches(rule: CatalogueHideCriteria, part: HideablePart) {
  if (rule.catalogId && part.catalogId !== rule.catalogId) return false;
  if (rule.materialId && part.materialId !== rule.materialId) return false;
  if (rule.categoryId && part.categoryId !== rule.categoryId) return false;
  if (rule.size) {
    if (part.sizeNominal === null || Number(part.sizeNominal) !== rule.size.nominal) return false;
    if (part.sizeUnit !== rule.size.unit) return false;
  }
  // Grouped summary rows carry no part id, so a single-part rule leaves them.
  if (rule.partId && part.id !== rule.partId) return false;
  return true;
}

export function isPartHidden(part: HideablePart, rules: readonly CatalogueHideCriteria[]) {
  return rules.some((rule) => ruleMatches(rule, part));
}

export function visibleParts<T extends HideablePart>(parts: T[], rules: readonly CatalogueHideCriteria[]) {
  return rules.length ? parts.filter((part) => !isPartHidden(part, rules)) : parts;
}

export function sameCriteria(a: CatalogueHideCriteria, b: CatalogueHideCriteria) {
  return (
    a.catalogId === b.catalogId &&
    a.materialId === b.materialId &&
    a.categoryId === b.categoryId &&
    a.partId === b.partId &&
    a.size?.nominal === b.size?.nominal &&
    a.size?.unit === b.size?.unit
  );
}
