import {
  sizeInSystemRange,
  type SystemAlternative,
  type SystemRule,
} from "./job-systems";
export function specMaterialCandidate(
  part: {
    displayName: string;
    description?: string | null;
    sizeNominal?: string | number | null;
    sizeUnitCode?: string | null;
  },
  rule: SystemRule,
  option: SystemAlternative,
) {
  const text = ` ${`${part.displayName} ${part.description ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const has = (term: string) =>
    text.includes(
      ` ${term
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()} `,
    );
  if (!option.requiredTerms.every(has)) return false;
  if (rule.componentTerms.length && !rule.componentTerms.some(has))
    return false;
  const size = Number(part.sizeNominal);
  return sizeInSystemRange(
    size > 0 && (part.sizeUnitCode === "in" || part.sizeUnitCode === "mm")
      ? { nominal: size, unit: part.sizeUnitCode }
      : null,
    rule.sizeRange,
  );
}
export function specMaterialRange(rule: SystemRule) {
  const r = rule.sizeRange;
  if (r.min == null && r.max == null) return "All specified sizes";
  return `${r.min == null ? "" : `${r.minInclusive ? "≥" : ">"} ${r.min}`} ${r.max == null ? "" : `${r.maxInclusive ? "≤" : "<"} ${r.max}`} ${r.unit}`.trim();
}
