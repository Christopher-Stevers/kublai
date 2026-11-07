import { describe, expect, it } from "vitest";
import {
  eligibleSystemParts, jobSystemRequirementsSchema, mapSystemAlternative, matchesAssessedComponent, mergeSystemRequirements,
  nominalInches, resolveSystemRequirements, sizeInSystemRange, systemAlternativeSchema,
  systemEvidenceSchema, systemRuleSchema, systemSizeRangeSchema, systemSourceIssues,
  type JobSystemRequirements, type SystemRule,
} from "./job-systems";

const COPPER = "00000000-0000-4000-8000-000000000001";
const STEEL = "00000000-0000-4000-8000-000000000002";
const DOC = "00000000-0000-4000-8000-000000000003";
const VERSION = "00000000-0000-4000-8000-000000000004";
const NEXT_VERSION = "00000000-0000-4000-8000-000000000005";
const CATALOG = "00000000-0000-4000-8000-000000000006";
const CATEGORY = "00000000-0000-4000-8000-000000000007";

const evidence = systemEvidenceSchema.parse({ id: "heating-p12", documentId: DOC, versionId: VERSION,
  documentTitle: "Mechanical specifications", page: 12, section: "23 21 13", quote: 'Heating pipe through 2 inches shall be copper; larger sizes shall be steel.' });
const alternative = (id = "copper", materialId = COPPER) => systemAlternativeSchema.parse({ id, label: id, materialId, materialLabel: id });
const rule = (extra: Partial<SystemRule> = {}): SystemRule => systemRuleSchema.parse({ id: "heating-pipe-small", label: "Small heating pipe",
  group: "pipe", alternatives: [alternative()], evidence: [evidence], reviewStatus: "approved", ...extra });
const requirements = (rules: SystemRule[] = [rule()], extra: Partial<JobSystemRequirements> = {}) => jobSystemRequirementsSchema.parse({
  systemName: "Heating", rules, applicabilityEvidence: [evidence], sourceVersions: [{ documentId: DOC, versionId: VERSION }], ...extra,
});
const line = { group: "pipe" as const, size: { unit: "in" as const, nominal: 2 } };

describe("job system requirement resolution", () => {
  it("uses nominal DN equivalents and respects inclusive/exclusive boundaries", () => {
    const small = rule({ sizeRange: systemSizeRangeSchema.parse({ max: 2 }) });
    const large = rule({ id: "heating-pipe-large", label: "Large heating pipe", sizeRange: systemSizeRangeSchema.parse({ min: 2, minInclusive: false }), alternatives: [alternative("steel", STEEL)] });
    const system = requirements([small, large]);
    for (const size of [{ unit: "in" as const, nominal: 2 }, { unit: "mm" as const, nominal: 50 }])
      expect(resolveSystemRequirements(system, { ...line, size }).alternative?.materialId).toBe(COPPER);
    for (const size of [{ unit: "in" as const, nominal: 2.5 }, { unit: "mm" as const, nominal: 65 }])
      expect(resolveSystemRequirements(system, { ...line, size }).alternative?.materialId).toBe(STEEL);
    const metric = systemSizeRangeSchema.parse({ unit: "mm", min: 50, max: 50 });
    expect(sizeInSystemRange(line.size, metric)).toBe(true);
    expect(sizeInSystemRange({ unit: "in", nominal: 1.5 }, metric)).toBe(false);
    expect(nominalInches({ unit: "mm", nominal: 75 })).toBe(3);
    expect(nominalInches({ unit: "mm", nominal: 80 })).toBe(3);
  });

  it("does not invent conversions for unknown nominal metric sizes", () => {
    expect(nominalInches({ unit: "mm", nominal: 51 })).toBeNull();
    expect(sizeInSystemRange({ unit: "mm", nominal: 51 }, systemSizeRangeSchema.parse({ max: 2 }))).toBe(false);
    expect(sizeInSystemRange({ unit: "mm", nominal: 51 }, systemSizeRangeSchema.parse({ unit: "mm", max: 51 }))).toBe(true);
  });

  it("blocks overlapping size boundaries rather than picking first", () => {
    const system = requirements([rule({ sizeRange: systemSizeRangeSchema.parse({ max: 2 }) }),
      rule({ id: "large", sizeRange: systemSizeRangeSchema.parse({ min: 2 }), alternatives: [alternative("steel", STEEL)] })]);
    const result = resolveSystemRequirements(system, line);
    expect(result.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toContain("overlapping_rules");
    expect(result.alternative).toBeNull();
  });

  it("requires an explicit choice when multiple materials are permitted", () => {
    const options = [alternative(), alternative("steel", STEEL)];
    const pending = resolveSystemRequirements(requirements([rule({ alternatives: options })]), line);
    expect(pending.status).toBe("blocked");
    expect(pending.issues.map((issue) => issue.code)).toContain("alternative_required");
    const chosen = resolveSystemRequirements(requirements([rule({ alternatives: options, selectedAlternativeId: "steel" })]), line);
    expect(chosen.status).toBe("ready");
    expect(chosen.alternative?.materialId).toBe(STEEL);
  });

  it("requires supporting passages and approval for inferred requirements", () => {
    const missing = resolveSystemRequirements(requirements([rule({ evidence: [], reviewStatus: "pending" })], { applicabilityEvidence: [] }), line);
    expect(missing.status).toBe("blocked");
    expect(missing.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["missing_evidence", "missing_applicability", "review_required"]));
    const manual = resolveSystemRequirements(requirements([rule({ origin: "manual", evidence: [] })], { applicabilityEvidence: [] }), line);
    expect(manual.status).toBe("ready");
  });

  it("keeps citations on resolved lines and blocks stale or missing source versions", () => {
    const system = requirements();
    const current = [{ documentId: DOC, versionId: VERSION }];
    expect(resolveSystemRequirements(system, line, current).evidence).toEqual([evidence]);
    expect(systemSourceIssues(system, current)).toEqual([]);
    expect(resolveSystemRequirements(system, line, [{ documentId: DOC, versionId: NEXT_VERSION }]).status).toBe("blocked");
    expect(systemSourceIssues(system, [])[0]?.message).toContain("no longer");
    expect(systemSourceIssues(system, [{ documentId: DOC, versionId: NEXT_VERSION }])).toHaveLength(1);
  });

  it("requires size even when a broad fallback could otherwise match", () => {
    const system = requirements([rule(), rule({ id: "large", sizeRange: systemSizeRangeSchema.parse({ min: 2 }) })]);
    const result = resolveSystemRequirements(system, { ...line, size: null });
    expect(result.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toContain("size_required");
  });

  it("isolates named valve scopes without leaking other rule issues", () => {
    const balancing = rule({ id: "balancing", label: "Circuit balancing valve", group: "valves", componentKinds: ["valve"], componentTerms: ["circuit balancing"] });
    const ball = rule({ id: "ball", label: "Ball valve", group: "valves", componentTerms: ["ball"] });
    const system = requirements([balancing, ball], { issues: [{ code: "ambiguous", message: "Ball valve requirement unclear", ruleId: "ball", blocking: true, resolved: false }] });
    const result = resolveSystemRequirements(system, { ...line, group: "valves", kind: "valve", name: "Circuit-balancing valve" });
    expect(result.status).toBe("ready");
    expect(result.rule?.id).toBe("balancing");
    expect(resolveSystemRequirements(system, { ...line, group: "valves", kind: "valve", name: "Ball valve" }).status).toBe("blocked");
  });

  it("does not interpret a catalogue alone as a material requirement", () => {
    const unmapped = rule({ alternatives: [systemAlternativeSchema.parse({ id: "copper", label: "Copper", catalogId: CATALOG })] });
    const result = resolveSystemRequirements(requirements([unmapped]), line);
    expect(result.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toContain("catalog_mapping_required");
  });

  it("filters exact catalogue/material/category and complete specification terms", () => {
    const chosen = systemAlternativeSchema.parse({ id: "a", label: "Type L copper", materialId: COPPER, categoryId: CATEGORY, catalogId: CATALOG, requiredTerms: ["Type L"] });
    const result = resolveSystemRequirements(requirements([rule({ alternatives: [chosen] })]), line);
    const part = { id: "right", displayName: '2" Copper pipe Type L', materialId: COPPER, categoryId: CATEGORY, catalogId: CATALOG };
    expect(eligibleSystemParts(result, [part, { ...part, id: "steel", materialId: STEEL }, { ...part, id: "othercat", catalogId: STEEL }, { ...part, id: "othercategory", categoryId: STEEL }, { ...part, id: "wrongtype", displayName: '2" Copper pipe Type M' }, { ...part, id: "partialword", displayName: '2" Copper pipe Type Long' }]).map((part) => part.id)).toEqual(["right"]);
  });

  it("applies joining constraints to fittings without requiring unmarked raw pipe text", () => {
    const joint = rule({ id: "joining", label: "Press joints", group: "joining", alternatives: [systemAlternativeSchema.parse({ id: "press", label: "Press", joining: "Press joints", requiredTerms: ["press"] })] });
    const system = requirements([rule(), rule({ id: "fittings", group: "fittings" }), joint]);
    const pipe = resolveSystemRequirements(system, line);
    expect(pipe.status).toBe("ready");
    expect(pipe.filters?.requiredTerms).toEqual([]);
    const fittings = resolveSystemRequirements(system, { ...line, group: "fittings", kind: "elbow", name: "90 elbow" });
    expect(fittings.status).toBe("ready");
    expect(fittings.joiningRules[0]?.rule.id).toBe("joining");
    expect(eligibleSystemParts(fittings, [{ id: "press", displayName: '2" Copper press 90', materialId: COPPER }, { id: "solder", displayName: '2" Copper solder 90', materialId: COPPER }]).map((part) => part.id)).toEqual(["press"]);
  });

  it("blocks unmapped or conflicting joining methods", () => {
    const joint = rule({ id: "joining", label: "Joints", group: "joining", alternatives: [systemAlternativeSchema.parse({ id: "a", label: "Threaded", joining: "Threaded joints" })] });
    const fitting = { ...line, group: "fittings" as const };
    let result = resolveSystemRequirements(requirements([rule({ group: "fittings" }), joint]), fitting);
    expect(result.issues.map((issue) => issue.code)).toContain("joining_mapping_required");
    expect(result.status).toBe("blocked");
    joint.alternatives[0]!.requiredTerms = ["threaded"];
    joint.alternatives[0]!.materialId = STEEL;
    result = resolveSystemRequirements(requirements([rule({ group: "fittings" }), joint]), fitting);
    expect(result.issues.map((issue) => issue.code)).toContain("joining_conflict");
    expect(result.status).toBe("blocked");
  });

  it("keeps unassessed legacy specs and their parts available", () => {
    const result = resolveSystemRequirements(undefined, line);
    expect(result.status).toBe("legacy");
    const parts = [{ id: "a", displayName: "A" }];
    expect(eligibleSystemParts(result, parts)).toEqual(parts);
    expect(eligibleSystemParts(resolveSystemRequirements(requirements([]), line), parts)).toEqual([]);
  });
});

describe("assessment reruns", () => {
  it("preserves manual corrections even when the assessment changes them", () => {
    const before = requirements([rule({ manualOverride: true, overrideReason: "Reviewed project addendum", alternatives: [alternative("steel", STEEL)] })]);
    const result = mergeSystemRequirements(before, requirements([rule({ evidence: [{ ...evidence, versionId: NEXT_VERSION }] })]));
    expect(result.rules[0]?.alternatives[0]?.materialId).toBe(STEEL);
    expect(result.rules[0]?.overrideReason).toBe("Reviewed project addendum");
    expect(result.issues.map((issue) => issue.code)).toContain("manual_override_preserved");
    expect(resolveSystemRequirements(result, line).status).toBe("blocked");
  });

  it("does not repeatedly invalidate an intentional correction when source evidence is unchanged", () => {
    const before = requirements([rule({ manualOverride: true, alternatives: [alternative("steel", STEEL)] })]);
    const result = mergeSystemRequirements(before, requirements());
    expect(result.rules[0]?.alternatives[0]?.materialId).toBe(STEEL);
    expect(result.issues.map((issue) => issue.code)).not.toContain("manual_override_preserved");
    expect(resolveSystemRequirements(result, line).status).toBe("ready");
  });

  it("retains custom bounds with refreshed evidence so a corrected rule can be approved after reassessment", () => {
    const before = requirements([rule({ manualOverride: true, sizeRange: systemSizeRangeSchema.parse({ max: 3 }), alternatives: [alternative("steel", STEEL)] })]);
    const incoming = requirements([rule({ sizeRange: systemSizeRangeSchema.parse({ max: 2 }), evidence: [{ ...evidence, versionId: NEXT_VERSION }] })], {
      applicabilityEvidence: [{ ...evidence, versionId: NEXT_VERSION }], sourceVersions: [{ documentId: DOC, versionId: NEXT_VERSION }],
    });
    const merged = mergeSystemRequirements(before, incoming);
    expect(merged.rules[0]?.sizeRange.max).toBe(3);
    expect(merged.rules[0]?.alternatives[0]?.materialId).toBe(STEEL);
    expect(merged.rules[0]?.evidence[0]?.versionId).toBe(NEXT_VERSION);
    expect(merged.rules[0]?.reviewStatus).toBe("pending");
    merged.rules[0]!.reviewStatus = "approved";
    merged.issues.forEach((item) => { item.resolved = true; });
    expect(resolveSystemRequirements(merged, line, [{ documentId: DOC, versionId: NEXT_VERSION }]).status).toBe("ready");
  });

  it("reconciles a unique changed threshold ID, preserving corrections and remapping incoming issues", () => {
    const before = requirements([rule({ id: "old-upper", manualOverride: true, sizeRange: systemSizeRangeSchema.parse({ max: 3 }), alternatives: [alternative("steel", STEEL)] }),
      rule({ id: "old-lower", sizeRange: systemSizeRangeSchema.parse({ min: 2, minInclusive: false }) })]);
    const incoming = requirements([rule({ id: "new-upper", sizeRange: systemSizeRangeSchema.parse({ max: 2.5 }), evidence: [{ ...evidence, versionId: NEXT_VERSION }] }),
      rule({ id: "new-lower", sizeRange: systemSizeRangeSchema.parse({ min: 2.5, minInclusive: false }), evidence: [{ ...evidence, versionId: NEXT_VERSION }] })], {
      issues: [{ code: "uncertain", message: "Check revised threshold", ruleId: "new-upper", blocking: true, resolved: false }],
    });
    const result = mergeSystemRequirements(before, incoming);
    expect(result.rules.map((rule) => rule.id)).toEqual(["old-upper", "old-lower"]);
    expect(result.rules[0]?.sizeRange.max).toBe(3);
    expect(result.rules[0]?.alternatives[0]?.materialId).toBe(STEEL);
    expect(result.rules[0]?.evidence[0]?.versionId).toBe(NEXT_VERSION);
    expect(result.issues.find((entry) => entry.code === "uncertain")?.ruleId).toBe("old-upper");
  });

  it("does not guess across ambiguous split clauses or unrelated source documents", () => {
    const before = requirements([rule({ id: "old", manualOverride: true, sizeRange: systemSizeRangeSchema.parse({ max: 3 }) })]);
    const split = requirements([rule({ id: "split-a", sizeRange: systemSizeRangeSchema.parse({ max: 2 }) }),
      rule({ id: "split-b", sizeRange: systemSizeRangeSchema.parse({ max: 4 }) })]);
    const result = mergeSystemRequirements(before, split);
    expect(result.rules.map((rule) => rule.id)).toEqual(["split-a", "split-b", "old"]);
    expect(resolveSystemRequirements(result, line).status).toBe("blocked");
    const unrelated = requirements([rule({ id: "other", sizeRange: systemSizeRangeSchema.parse({ max: 2 }), evidence: [{ ...evidence, documentId: STEEL }] })]);
    expect(mergeSystemRequirements(before, unrelated).rules.map((rule) => rule.id)).toEqual(["other", "old"]);
  });

  it("preserves explicit deletions, manual names and manual rules missing in the new result", () => {
    const manual = rule({ id: "manual", origin: "manual" });
    const before = requirements([manual], { systemName: "Tim's heating", manualName: true, suppressedRuleIds: ["heating-pipe-small"] });
    const result = mergeSystemRequirements(before, requirements());
    expect(result.systemName).toBe("Tim's heating");
    expect(result.rules.map((rule) => rule.id)).toEqual(["manual"]);
    expect(result.suppressedRuleIds).toEqual(["heating-pipe-small"]);
    expect(result.issues.map((issue) => issue.code)).toContain("manual_rule_not_found");
  });

  it("retains choice by identity when options reorder or IDs change", () => {
    const before = requirements([rule({ alternatives: [alternative(), alternative("steel", STEEL)], selectedAlternativeId: "steel" })]);
    const steel = { ...alternative("steel", STEEL), id: "new-steel" };
    const after = requirements([rule({ alternatives: [steel, alternative()], reviewStatus: "pending" })]);
    const result = mergeSystemRequirements(before, after);
    expect(result.rules[0]?.selectedAlternativeId).toBe("new-steel");
    expect(result.rules[0]?.reviewStatus).toBe("pending");
  });

  it("does not transfer approval or a choice to a replaced material", () => {
    const before = requirements([rule({ selectedAlternativeId: "copper" })]);
    const after = requirements([rule({ alternatives: [alternative("steel", STEEL)] })]);
    const result = mergeSystemRequirements(before, after);
    expect(result.rules[0]?.selectedAlternativeId).toBeNull();
    expect(result.rules[0]?.reviewStatus).toBe("pending");
    expect(result.issues.map((issue) => issue.code)).toContain("selected_option_changed");
  });

  it("keeps approval for identical evidence but resets it on changed document versions", () => {
    const before = requirements();
    const identical = requirements([rule({ reviewStatus: "pending" })]);
    expect(mergeSystemRequirements(before, identical).rules[0]?.reviewStatus).toBe("approved");
    const changed = requirements([rule({ evidence: [{ ...evidence, versionId: NEXT_VERSION }] })]);
    expect(mergeSystemRequirements(before, changed).rules[0]?.reviewStatus).toBe("pending");
  });

  it("preserves resolved review issues only when their evidence and requirements remain identical", () => {
    const issues = [
      { code: "scope", message: "Confirm component scope", ruleId: "heating-pipe-small", blocking: true, resolved: false },
      { code: "coverage", message: "Confirm system coverage", ruleId: null, blocking: true, resolved: false },
    ];
    const before = requirements([rule()], { issues: issues.map((entry) => ({ ...entry, resolved: true })) });
    const identical = mergeSystemRequirements(before, requirements([rule()], { issues }));
    expect(identical.issues.every((entry) => entry.resolved)).toBe(true);
    expect(resolveSystemRequirements(identical, line).status).toBe("ready");
    const changedEvidence = mergeSystemRequirements(before, requirements([rule({ evidence: [{ ...evidence, quote: "A revised mandatory material clause." }] })], { issues }));
    expect(changedEvidence.issues.every((entry) => !entry.resolved)).toBe(true);
    const changedMaterial = mergeSystemRequirements(before, requirements([rule({ alternatives: [alternative("steel", STEEL)] })], { issues }));
    expect(changedMaterial.issues.every((entry) => !entry.resolved)).toBe(true);
    const changedMeaning = mergeSystemRequirements(before, requirements([rule()], { issues: [{ ...issues[0]!, message: "Confirm a different condition" }] }));
    expect(changedMeaning.issues[0]?.resolved).toBe(false);
  });
});

describe("strict assessed fitting shapes", () => {
  const elbow = (name: string) => ({ ...line, group: "fittings" as const, kind: "elbow", name });
  const valve = (name: string) => ({ ...line, group: "valves" as const, kind: "valve", name });

  it("rejects wrong or unknown elbow angles while accepting equivalent bend names", () => {
    expect(matchesAssessedComponent(elbow("90° elbow"), { displayName: '2" Copper 90' })).toBe(true);
    expect(matchesAssessedComponent(elbow("90° UP"), { displayName: '2" ABS 1/4 Bend' })).toBe(true);
    expect(matchesAssessedComponent(elbow("45° elbow"), { displayName: '2" ABS 1/8 bend' })).toBe(true);
    expect(matchesAssessedComponent(elbow("22° elbow"), { displayName: '2" ABS 1/16 Bend' })).toBe(true);
    expect(matchesAssessedComponent(elbow("22.5° elbow"), { displayName: '2" Steel 22½ Elbow' })).toBe(true);
    expect(matchesAssessedComponent(elbow("45° elbow"), { displayName: '2" Copper 22.5 Elbow' })).toBe(false);
    expect(matchesAssessedComponent(elbow("90° elbow"), { displayName: '2" Steel 180 Elbow' })).toBe(false);
    expect(matchesAssessedComponent(elbow("90° elbow"), { displayName: '2" Copper Elbow' })).toBe(false);
    expect(matchesAssessedComponent(elbow("Elbow"), { displayName: '2" Copper 90 Elbow' })).toBe(false);
  });

  it("does not mistake nominal sizes for bend angles or let generic descriptions override the title", () => {
    expect(matchesAssessedComponent(elbow("90° elbow"), { displayName: "DN90 Copper 45 elbow" })).toBe(false);
    expect(matchesAssessedComponent(elbow("90° elbow"), { displayName: "90 mm Copper 45 elbow" })).toBe(false);
    expect(matchesAssessedComponent(elbow("45° elbow"), { displayName: "DN90 Copper 45 elbow" })).toBe(true);
    expect(matchesAssessedComponent(elbow("90° elbow"), { displayName: '2" Copper 45 elbow', description: "Available in 45 and 90 degrees" })).toBe(false);
  });

  it("requires named valves to match the normalized type, including hyphenated names", () => {
    expect(matchesAssessedComponent(valve("Circuit-balancing valve"), { displayName: '2" Circuit Balancing Valve' })).toBe(true);
    expect(matchesAssessedComponent(valve("Circuit-balancing valve"), { displayName: '2" Ball Valve' })).toBe(false);
    expect(matchesAssessedComponent(valve("Ball valve"), { displayName: '2" Ball Check Valve' })).toBe(false);
    expect(matchesAssessedComponent(valve("Gate valve"), { displayName: '2" Ball Valve', description: "Full line of gate valves" })).toBe(false);
    expect(matchesAssessedComponent(valve("Valve"), { displayName: '2" Ball Valve' })).toBe(true);
    expect(matchesAssessedComponent(valve("Pressure-reducing valve"), { displayName: "PRV", aliases: ["Pressure reducing valve"] })).toBe(true);
  });
});

describe("typed requirements and catalogue mapping", () => {
  it("rejects impossible ranges, duplicate rules/options and selections outside allowed options", () => {
    expect(systemSizeRangeSchema.safeParse({ min: 4, max: 2 }).success).toBe(false);
    expect(systemSizeRangeSchema.safeParse({ min: 2, max: 2, maxInclusive: false }).success).toBe(false);
    expect(systemRuleSchema.safeParse({ ...rule(), selectedAlternativeId: "missing" }).success).toBe(false);
    expect(systemRuleSchema.safeParse({ ...rule(), alternatives: [alternative(), alternative()] }).success).toBe(false);
    expect(jobSystemRequirementsSchema.safeParse({ ...requirements(), rules: [rule(), rule()] }).success).toBe(false);
  });

  it("automatically maps only unique exact names or provided aliases, preserving explicit mappings", () => {
    const option = systemAlternativeSchema.parse({ id: "a", label: "Copper", materialLabel: "Copper tube", categoryLabel: "Pipe", catalogLabel: "Plumbing" });
    const facets = { materials: [{ id: COPPER, name: "Copper", aliases: ["Copper tube"] }], categories: [{ id: CATEGORY, name: "Pipe" }], catalogs: [{ id: CATALOG, name: "Plumbing" }] };
    expect(mapSystemAlternative(option, facets)).toMatchObject({ materialId: COPPER, categoryId: CATEGORY, catalogId: CATALOG });
    expect(mapSystemAlternative({ ...option, materialId: STEEL }, facets).materialId).toBe(STEEL);
    expect(mapSystemAlternative(option, { ...facets, materials: [...facets.materials, { id: STEEL, name: "Copper tube" }] }).materialId).toBeNull();
    expect(mapSystemAlternative({ ...option, materialLabel: "Stainless steel" }, { ...facets, materials: [{ id: STEEL, name: "Steel" }] }).materialId).toBeNull();
  });
});
