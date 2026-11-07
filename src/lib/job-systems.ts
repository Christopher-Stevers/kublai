import { z } from "zod";
import type { PipeSize } from "./pipe-run-sizes";

const keySchema = z.string().trim().min(1).max(160);
const nameSchema = z.string().trim().min(1).max(240);
const idSchema = z.string().uuid().nullable().default(null);

/** Document pages are one-based, matching the Documents viewer. */
export const systemEvidenceSchema = z.object({
  id: keySchema,
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  documentTitle: nameSchema,
  page: z.number().int().positive().max(100000).nullable().default(null),
  section: z.string().trim().max(240).nullable().default(null),
  quote: z.string().trim().min(1).max(6000),
  drawing: z.object({ setId: z.string().uuid(), sheetId: z.string().uuid(), sourceSheetId: z.string().uuid() }).optional(),
});
export type SystemEvidence = z.infer<typeof systemEvidenceSchema>;

export const systemIssueSchema = z.object({
  code: keySchema,
  message: z.string().trim().min(1).max(2000),
  ruleId: keySchema.nullable().default(null),
  blocking: z.boolean().default(true),
  resolved: z.boolean().default(false),
});
export type SystemIssue = z.infer<typeof systemIssueSchema>;

export const systemSizeRangeSchema = z.object({
  unit: z.enum(["in", "mm"]).default("in"),
  min: z.number().positive().max(10000).nullable().default(null),
  max: z.number().positive().max(10000).nullable().default(null),
  minInclusive: z.boolean().default(true),
  maxInclusive: z.boolean().default(true),
}).refine((range) => range.min == null || range.max == null || range.min < range.max ||
  (range.min === range.max && range.minInclusive && range.maxInclusive), "Empty size range");
export type SystemSizeRange = z.infer<typeof systemSizeRangeSchema>;

export const systemAlternativeSchema = z.object({
  id: keySchema,
  label: nameSchema,
  materialId: idSchema,
  materialLabel: z.string().trim().max(240).nullable().default(null),
  categoryId: idSchema,
  categoryLabel: z.string().trim().max(240).nullable().default(null),
  catalogId: idSchema,
  catalogLabel: z.string().trim().max(240).nullable().default(null),
  /** Keep specification language visible even when no catalogue facet exists. */
  joining: z.string().trim().max(2000).nullable().default(null),
  /** Additional verified catalogue text constraints, e.g. Type L or Sch 40. */
  requiredTerms: z.array(nameSchema).max(20).default([]),
});
export type SystemAlternative = z.infer<typeof systemAlternativeSchema>;

export const systemRuleSchema = z.object({
  /** Stable semantic key: source section + group + scope, not array position. */
  id: keySchema,
  label: nameSchema,
  group: z.enum(["pipe", "fittings", "valves", "joining"]),
  /** Joining descriptions commonly describe fittings/valve ends, not raw pipe. */
  appliesTo: z.array(z.enum(["pipe", "fittings", "valves"])).min(1).max(3).default(["fittings", "valves"]),
  sizeRange: systemSizeRangeSchema.default({ unit: "in", min: null, max: null, minInclusive: true, maxInclusive: true }),
  /** Restrict specialized fittings or valves. Empty means the whole group. */
  componentKinds: z.array(keySchema).max(30).default([]),
  componentTerms: z.array(nameSchema).max(20).default([]),
  alternatives: z.array(systemAlternativeSchema).max(30).default([]),
  selectedAlternativeId: keySchema.nullable().default(null),
  evidence: z.array(systemEvidenceSchema).max(100).default([]),
  reviewStatus: z.enum(["pending", "approved"]).default("pending"),
  origin: z.enum(["assessment", "manual"]).default("assessment"),
  manualOverride: z.boolean().default(false),
  overrideReason: z.string().trim().max(2000).nullable().default(null),
}).superRefine((rule, ctx) => {
  const ids = rule.alternatives.map((item) => item.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["alternatives"], message: "Alternative IDs must be unique" });
  if (rule.selectedAlternativeId && !ids.includes(rule.selectedAlternativeId)) ctx.addIssue({ code: "custom", path: ["selectedAlternativeId"], message: "Choose a permitted alternative" });
});
export type SystemRule = z.infer<typeof systemRuleSchema>;

export const systemSourceVersionSchema = z.object({ documentId: z.string().uuid(), versionId: z.string().uuid() });
export type SystemSourceVersion = z.infer<typeof systemSourceVersionSchema>;

export const jobSystemRequirementsSchema = z.object({
  version: z.literal(1).default(1),
  systemName: nameSchema,
  applicabilityEvidence: z.array(systemEvidenceSchema).max(100).default([]),
  rules: z.array(systemRuleSchema).max(400).default([]),
  issues: z.array(systemIssueSchema).max(400).default([]),
  sourceVersions: z.array(systemSourceVersionSchema).max(600).default([]),
  /** Explicit deletions are tombstones so the next assessment cannot resurrect them. */
  suppressedRuleIds: z.array(keySchema).max(400).default([]),
  manualName: z.boolean().default(false),
}).superRefine((requirements, ctx) => {
  const ids = requirements.rules.map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["rules"], message: "Rule IDs must be unique" });
});
export type JobSystemRequirements = z.infer<typeof jobSystemRequirementsSchema>;

/** Nominal DN is a designation, not the result of multiplying inches by 25.4. */
const NOMINAL_INCHES: readonly [number, number][] = [
  [6, 0.125], [8, 0.25], [10, 0.375], [15, 0.5], [20, 0.75], [25, 1], [32, 1.25],
  [40, 1.5], [50, 2], [65, 2.5], [75, 3], [80, 3], [90, 3.5], [100, 4], [125, 5],
  [150, 6], [200, 8], [250, 10], [300, 12], [350, 14], [400, 16], [450, 18],
  [500, 20], [550, 22], [600, 24], [650, 26], [700, 28], [750, 30], [800, 32],
  [900, 36], [1000, 40], [1200, 48],
];

/** Returns null for unknown cross-unit nominal sizes instead of guessing a conversion. */
export function nominalInches(size: PipeSize): number | null {
  if (!(size.nominal > 0) || !Number.isFinite(size.nominal)) return null;
  return size.unit === "in" ? size.nominal : NOMINAL_INCHES.find(([dn]) => dn === size.nominal)?.[1] ?? null;
}

export function sizeInSystemRange(size: PipeSize | null, range: SystemSizeRange): boolean {
  if (range.min == null && range.max == null) return true;
  if (!size || !(size.nominal > 0)) return false;
  const value = size.unit === range.unit ? size.nominal : nominalInches(size);
  const min = range.min == null ? null : size.unit === range.unit ? range.min : nominalInches({ nominal: range.min, unit: range.unit });
  const max = range.max == null ? null : size.unit === range.unit ? range.max : nominalInches({ nominal: range.max, unit: range.unit });
  if (value == null || (range.min != null && min == null) || (range.max != null && max == null)) return false;
  const epsilon = 1e-7;
  return (min == null || (range.minInclusive ? value >= min - epsilon : value > min + epsilon)) &&
    (max == null || (range.maxInclusive ? value <= max + epsilon : value < max - epsilon));
}

export type SystemRequirementLine = {
  group: "pipe" | "fittings" | "valves";
  size: PipeSize | null;
  kind?: string;
  name?: string;
  label?: string;
};

const normalizedText = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hasTerm = (text: string, term: string) => {
  const normalized = normalizedText(term);
  return normalized.length > 0 && ` ${normalizedText(text)} `.includes(` ${normalized} `);
};

function matchesScope(rule: SystemRule, line: SystemRequirementLine) {
  return (!rule.componentKinds.length || (!!line.kind && rule.componentKinds.includes(line.kind))) &&
    (!rule.componentTerms.length || rule.componentTerms.some((term) => hasTerm(line.name ?? line.label ?? "", term)));
}

function issue(code: string, message: string, ruleId: string | null = null, blocking = true): SystemIssue {
  return { code, message, ruleId, blocking, resolved: false };
}

export type SystemCatalogFilters = {
  materialId: string | null;
  categoryId: string | null;
  catalogId: string | null;
  requiredTerms: string[];
};

export type SystemRequirementResolution = {
  status: "legacy" | "ready" | "blocked";
  rule: SystemRule | null;
  alternative: SystemAlternative | null;
  joiningRules: { rule: SystemRule; alternative: SystemAlternative }[];
  evidence: SystemEvidence[];
  issues: SystemIssue[];
  filters: SystemCatalogFilters | null;
};

/** Report a superseded or removed source without losing its original citation. */
export function systemSourceIssues(requirements: JobSystemRequirements, current: readonly SystemSourceVersion[]): SystemIssue[] {
  const versions = new Map(current.map((source) => [source.documentId, source.versionId]));
  const referenced = [...requirements.sourceVersions, ...requirements.applicabilityEvidence, ...requirements.rules.flatMap((rule) => rule.evidence)];
  const outdated = new Map<string, SystemSourceVersion>();
  for (const source of referenced) {
    if (versions.get(source.documentId) !== source.versionId) outdated.set(source.documentId, source);
  }
  return [...outdated.values()].map((source) => issue(
    "source_changed",
    versions.has(source.documentId) ? "A source document or drawing has a newer version. Reassess the system before generating materials." : "A referenced document or drawing is no longer available.",
  ));
}

/**
 * A missing requirements block keeps legacy manual specs working. Once present,
 * rules must resolve explicitly; a broad legacy material is never a fallback.
 */
export function resolveSystemRequirements(
  requirements: JobSystemRequirements | null | undefined,
  line: SystemRequirementLine,
  currentSources?: readonly SystemSourceVersion[],
): SystemRequirementResolution {
  const result: SystemRequirementResolution = { status: "legacy", rule: null, alternative: null, joiningRules: [], evidence: [], issues: [], filters: null };
  if (!requirements) return result;
  result.status = "blocked";
  const groupRules = requirements.rules.filter((rule) => rule.group === line.group && matchesScope(rule, line));
  const joiningScope = requirements.rules.filter((rule) => rule.group === "joining" && rule.appliesTo.includes(line.group) && matchesScope(rule, line));
  const rules = groupRules.filter((rule) => sizeInSystemRange(line.size, rule.sizeRange));
  const joining = joiningScope.filter((rule) => sizeInSystemRange(line.size, rule.sizeRange));
  const relevantIds = new Set([...rules, ...joining].map((rule) => rule.id));
  result.issues.push(...requirements.issues.filter((item) => !item.resolved && (!item.ruleId || relevantIds.has(item.ruleId))));
  if (currentSources) result.issues.push(...systemSourceIssues(requirements, currentSources));
  if (!line.size && [...groupRules, ...joiningScope].some((rule) => rule.sizeRange.min != null || rule.sizeRange.max != null)) {
    result.issues.push(issue("size_required", "Choose a pipe size so the correct specification range can be applied."));
  }
  if (!rules.length) result.issues.push(issue("missing_rule", `No ${line.group} requirement covers this item and size.`));
  if (rules.length > 1) result.issues.push(issue("overlapping_rules", `Multiple ${line.group} requirements apply. Resolve their scope before selecting materials.`));
  if (joining.length > 1) result.issues.push(issue("overlapping_joining", "Multiple joining requirements apply. Resolve their scope before selecting materials."));
  if (!requirements.applicabilityEvidence.length && requirements.rules.some((rule) => rule.origin === "assessment" && !rule.manualOverride)) {
    result.issues.push(issue("missing_applicability", "The assessment has no supporting passage explaining why this system applies to the job."));
  }
  const evidence = new Map(requirements.applicabilityEvidence.map((entry) => [entry.id, entry]));
  const choose = (rule: SystemRule) => {
    for (const entry of rule.evidence) evidence.set(entry.id, entry);
    if (rule.reviewStatus !== "approved") result.issues.push(issue("review_required", `Review “${rule.label}” before using it for materials.`, rule.id));
    if (!rule.evidence.length && !(rule.origin === "manual" || rule.manualOverride)) result.issues.push(issue("missing_evidence", `“${rule.label}” has no supporting specification passage.`, rule.id));
    // One permitted option is unambiguous. Multiple permitted options are never
    // reduced to the first item, even if one happens to have a catalogue match.
    const alternative = rule.selectedAlternativeId
      ? rule.alternatives.find((entry) => entry.id === rule.selectedAlternativeId)
      : rule.alternatives.length === 1 ? rule.alternatives[0] : undefined;
    if (!alternative) result.issues.push(issue("alternative_required", rule.alternatives.length ? `Choose a permitted option for “${rule.label}”.` : `“${rule.label}” has no permitted material option.`, rule.id));
    return alternative ?? null;
  };
  for (const rule of joining) {
    const alternative = choose(rule);
    if (alternative) result.joiningRules.push({ rule, alternative });
  }
  if (rules.length === 1) {
    const rule = rules[0]!;
    result.rule = rule;
    result.alternative = choose(rule);
    if (result.alternative) {
      const { materialId, categoryId, catalogId, requiredTerms } = result.alternative;
      // A catalogue alone identifies a collection, not an allowed material.
      if (!materialId && !categoryId) result.issues.push(issue("catalog_mapping_required", `Map “${result.alternative.label}” to a catalogue material or category.`, rule.id));
      result.filters = { materialId, categoryId, catalogId, requiredTerms: [...requiredTerms] };
      for (const joined of result.joiningRules) {
        // A material name by itself cannot prove that a fitting has the
        // specified joint. Require an actual method-specific category or text.
        if (!joined.alternative.categoryId && !joined.alternative.requiredTerms.length) {
          result.issues.push(issue("joining_mapping_required", `Map the joining method “${joined.alternative.label}” to a category or verified catalogue terms.`, joined.rule.id));
          continue;
        }
        for (const facet of ["materialId", "categoryId", "catalogId"] as const) {
          const required = joined.alternative[facet];
          if (!required) continue;
          if (result.filters[facet] && result.filters[facet] !== required) result.issues.push(issue("joining_conflict", `The joining and material requirements specify different ${facet.replace("Id", "")} selections.`, joined.rule.id));
          else result.filters[facet] = required;
        }
        result.filters.requiredTerms.push(...joined.alternative.requiredTerms);
      }
    }
  }
  result.evidence = [...evidence.values()];
  result.status = result.filters && !result.issues.some((entry) => entry.blocking && !entry.resolved) ? "ready" : "blocked";
  return result;
}

export type SystemCatalogPart = {
  id: string;
  materialId?: string | null;
  categoryId?: string | null;
  catalogId?: string | null;
  displayName: string;
  description?: string | null;
  aliases?: readonly string[];
};

/** Apply requirement facets before the existing pipe-spec size/kind ranking. */
export function eligibleSystemParts<T extends SystemCatalogPart>(resolution: SystemRequirementResolution, parts: readonly T[]): T[] {
  if (resolution.status === "legacy") return [...parts];
  if (resolution.status !== "ready" || !resolution.filters) return [];
  const filters = resolution.filters;
  return parts.filter((part) =>
    (!filters.materialId || part.materialId === filters.materialId) &&
    (!filters.categoryId || part.categoryId === filters.categoryId) &&
    (!filters.catalogId || part.catalogId === filters.catalogId) &&
    filters.requiredTerms.every((term) => hasTerm([part.displayName, part.description ?? "", ...(part.aliases ?? [])].join(" "), term)),
  );
}

function fittingAngles(text: string) {
  const angles = new Set<number>();
  for (const [pattern, value] of [
    [/\b1\s*\/\s*4\s*bend\b|¼\s*bend\b|\bquarter\s*bend\b/gi, 90],
    [/\b1\s*\/\s*8\s*bend\b|⅛\s*bend\b|\beighth\s*bend\b/gi, 45],
    [/\b1\s*\/\s*16\s*bend\b|\bsixteenth\s*bend\b/gi, 22.5],
  ] as const) if (pattern.test(text)) angles.add(value);
  for (const match of text.matchAll(/(?<![\d.])(11\.25|22\.5|22½|22|30|45|60|90|120|135|180)(?![\d.])/g)) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length).trimStart();
    // DN90 and 90 mm identify a size, not a ninety-degree bend. A fitting's
    // printed angle may stand alone (e.g. "Copper 90"), so degrees are optional.
    if (/\b(?:DN|NPS|size)\s*$/i.test(before) || /^(?:mm\b|in(?:ch(?:es)?)?\b|["″']|[x×]\s*\d)/i.test(after)) continue;
    const value = match[1] === "22" || match[1] === "22½" ? 22.5 : Number(match[1]);
    angles.add(value);
  }
  return angles;
}

/**
 * Strict assessed takeoffs cannot use an unknown angle or unrelated valve type
 * merely because the nominal size matches. Legacy hand-picked lists can retain
 * their broader search. Call after normal size/kind candidate filtering.
 */
export function matchesAssessedComponent(line: SystemRequirementLine, part: Pick<SystemCatalogPart, "displayName" | "description" | "aliases">): boolean {
  const sourceName = line.name ?? line.label ?? "";
  const text = [part.displayName, part.description ?? "", ...(part.aliases ?? [])].join(" ");
  if (line.kind === "elbow") {
    const expected = fittingAngles(sourceName);
    if (expected.size !== 1) return false;
    const primary = fittingAngles(part.displayName);
    const actual = primary.size ? primary : fittingAngles(text);
    return actual.size === 1 && actual.has([...expected][0]!);
  }
  if (line.kind === "valve") {
    const type = normalizedText(sourceName).replace(/\bvalves?\b/g, "").trim();
    if (!type || ["unknown", "unidentified", "generic"].includes(type)) return true;
    const expected = `${type} valve`;
    const combined = normalizedText(text).replace(/\bvalves\b/g, "valve");
    const primary = normalizedText(part.displayName).replace(/\bvalves\b/g, "valve");
    if (hasTerm(primary, expected)) return true;
    // Do not let a supplier's generic description override a plainly different
    // product title (e.g. a ball valve description mentioning gate valves).
    const families = ["ball", "check", "gate", "globe", "butterfly", "balancing", "pressure reducing", "pressure relief", "mixing", "diverting", "solenoid", "zone"];
    if (families.some((family) => hasTerm(primary, `${family} valve`) && !hasTerm(type, family))) return false;
    return hasTerm(combined, expected);
  }
  return true;
}

/** User-selected alternative is retained by identity, never by array index. */
function sameAlternative(a: SystemAlternative, b: SystemAlternative) {
  return normalizedText(a.label) === normalizedText(b.label) &&
    normalizedText(a.materialLabel ?? "") === normalizedText(b.materialLabel ?? "") &&
    normalizedText(a.joining ?? "") === normalizedText(b.joining ?? "");
}

function ruleContent(rule: SystemRule) {
  return JSON.stringify({ group: rule.group, appliesTo: rule.appliesTo, sizeRange: rule.sizeRange, componentKinds: rule.componentKinds,
    componentTerms: rule.componentTerms, alternatives: rule.alternatives,
    evidence: rule.evidence.map((entry) => ({ documentId: entry.documentId, versionId: entry.versionId, page: entry.page, section: entry.section, quote: entry.quote })) });
}

function ruleEvidence(rule: SystemRule) {
  return JSON.stringify(rule.evidence.map((entry) => ({ documentId: entry.documentId, versionId: entry.versionId,
    page: entry.page, section: entry.section, quote: entry.quote })));
}

function sameRuleScope(a: SystemRule, b: SystemRule) {
  const sorted = (values: readonly string[]) => [...values].map(normalizedText).sort().join("|");
  if (a.group !== b.group || sorted(a.componentKinds) !== sorted(b.componentKinds) || sorted(a.componentTerms) !== sorted(b.componentTerms)) return false;
  if (a.group === "joining" && sorted(a.appliesTo) !== sorted(b.appliesTo)) return false;
  // An upper-bound clause can survive a threshold change. It cannot silently
  // replace a lower-bound clause or one of several newly split intervals.
  if ((a.sizeRange.min == null) !== (b.sizeRange.min == null) || (a.sizeRange.max == null) !== (b.sizeRange.max == null)) return false;
  const anchor = (entry: SystemEvidence) => `${entry.documentId}|${entry.section ? `section:${normalizedText(entry.section)}` : `page:${entry.page}`}`;
  const anchors = new Set(a.evidence.map(anchor));
  return b.evidence.some((entry) => anchors.has(anchor(entry)));
}

/**
 * Assessment is replaceable evidence; human corrections are durable intent.
 * Unchanged results keep approval. Changed evidence/options require re-review.
 * Manual rules, deletions, chosen options and system names survive a rerun.
 */
export function mergeSystemRequirements(previous: JobSystemRequirements | null | undefined, incoming: JobSystemRequirements): JobSystemRequirements {
  if (!previous) return jobSystemRequirementsSchema.parse(incoming);
  const suppressed = new Set(previous.suppressedRuleIds);
  const old = new Map(previous.rules.map((rule) => [rule.id, rule]));
  const incomingRules = incoming.rules.filter((rule) => !suppressed.has(rule.id));
  const incomingIds = new Set(incomingRules.map((rule) => rule.id));
  const previousIds = new Set(previous.rules.map((rule) => rule.id));
  const issueRuleIds = new Map<string, string>();
  const unchangedRuleIds = new Set<string>();
  const issues = [...incoming.issues];
  const rules = incomingRules.map((next) => {
    let before = old.get(next.id);
    if (!before) {
      const candidates = [...old.values()].filter((rule) => !incomingIds.has(rule.id) && !suppressed.has(rule.id) && sameRuleScope(rule, next));
      const candidate = candidates.length === 1 ? candidates[0] : undefined;
      // Only a unique relationship in BOTH directions is safe. Do not guess
      // when one old rule becomes several clauses or several old rules merge.
      if (candidate && incomingRules.filter((rule) => !previousIds.has(rule.id) && sameRuleScope(candidate, rule)).length === 1) before = candidate;
    }
    if (!before) return next;
    old.delete(before.id);
    issueRuleIds.set(next.id, before.id);
    const changed = ruleContent(before) !== ruleContent(next);
    if (!changed) unchangedRuleIds.add(before.id);
    if (before.manualOverride || before.origin === "manual") {
      const evidenceChanged = ruleEvidence(before) !== ruleEvidence(next);
      if (evidenceChanged) issues.push(issue("manual_override_preserved", `The source for “${before.label}” changed in the new assessment; your correction was kept. Review it against the new source.`, before.id));
      return { ...before, evidence: next.evidence, reviewStatus: evidenceChanged ? "pending" as const : before.reviewStatus };
    }
    const selected = before.alternatives.find((alternative) => alternative.id === before.selectedAlternativeId);
    const replacement = selected ? next.alternatives.find((alternative) => alternative.id === selected.id && sameAlternative(alternative, selected)) ??
      next.alternatives.find((alternative) => sameAlternative(alternative, selected)) : undefined;
    if (selected && !replacement) issues.push(issue("selected_option_changed", `The previously chosen option for “${next.label}” is no longer supported by the assessment. Choose again.`, before.id));
    return { ...next, id: before.id, selectedAlternativeId: replacement?.id ?? next.selectedAlternativeId,
      reviewStatus: changed ? "pending" as const : before.reviewStatus };
  });
  for (const before of old.values()) {
    if (suppressed.has(before.id) || (!before.manualOverride && before.origin !== "manual")) continue;
    rules.push(before);
    issues.push(issue("manual_rule_not_found", `“${before.label}” was not found in the new assessment. Your manual rule was kept for review.`, before.id, before.origin !== "manual"));
  }
  const wholeSystemUnchanged = previous.rules.length === incomingRules.length && incomingRules.every((rule) => unchangedRuleIds.has(issueRuleIds.get(rule.id) ?? rule.id)) &&
    JSON.stringify(previous.applicabilityEvidence) === JSON.stringify(incoming.applicabilityEvidence) &&
    JSON.stringify(previous.sourceVersions) === JSON.stringify(incoming.sourceVersions);
  const mergedIssues = issues.map((entry) => {
    const ruleId = entry.ruleId ? issueRuleIds.get(entry.ruleId) ?? entry.ruleId : null;
    const unchanged = ruleId ? unchangedRuleIds.has(ruleId) : wholeSystemUnchanged;
    const wasResolved = unchanged && previous.issues.some((oldIssue) => oldIssue.resolved && oldIssue.ruleId === ruleId &&
      oldIssue.code === entry.code && oldIssue.message === entry.message && oldIssue.blocking === entry.blocking);
    return { ...entry, ruleId, resolved: entry.resolved || wasResolved };
  });
  return jobSystemRequirementsSchema.parse({ ...incoming, systemName: previous.manualName ? previous.systemName : incoming.systemName,
    manualName: previous.manualName, rules, issues: mergedIssues, suppressedRuleIds: [...suppressed] });
}

export type SystemCatalogFacet = { id: string; name: string; aliases?: readonly string[] };
export type SystemCatalogFacets = { materials: readonly SystemCatalogFacet[]; categories: readonly SystemCatalogFacet[]; catalogs: readonly SystemCatalogFacet[] };

/** Exact, unique facet mappings only; uncertain semantic choices stay visible. */
export function mapSystemAlternative(alternative: SystemAlternative, facets: SystemCatalogFacets): SystemAlternative {
  const lookup = (label: string | null, entries: readonly SystemCatalogFacet[]) => {
    if (!label) return null;
    const matches = entries.filter((entry) => [entry.name, ...(entry.aliases ?? [])].some((name) => normalizedText(name) === normalizedText(label)));
    return matches.length === 1 ? matches[0]!.id : null;
  };
  return { ...alternative,
    materialId: alternative.materialId ?? lookup(alternative.materialLabel, facets.materials),
    categoryId: alternative.categoryId ?? lookup(alternative.categoryLabel, facets.categories),
    catalogId: alternative.catalogId ?? lookup(alternative.catalogLabel, facets.catalogs) };
}
