// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  assessPassages,
  sizeRanges,
  specificationPassages,
  type Evaluator,
} from "./analyze";
import {
  mapSystemAlternative,
  resolveSystemRequirements,
  jobSystemRequirementsSchema,
} from "~/lib/job-systems";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = {
  documentId: id(1),
  versionId: id(2),
  name: "Heating specification.pdf",
  sha256: "a".repeat(64),
  mimeType: "application/pdf",
};
const text =
  "HEATING WATER PIPING\nPipe up to and including 2 inches shall be Type L copper or stainless steel.\nPipe over 2 inches shall be Schedule 40 carbon steel.\nFittings shall use threaded joints.";
const fixture: Evaluator = async (_state, questions) => ({
  model: "simulated",
  answers: Object.fromEntries(
    Object.entries(questions).map(([id, q]) => {
      const p = q.instructions as {
        component?: string;
        material?: string;
        method?: string;
        task: string;
      };
      let choice = "no";
      if (id.endsWith("_applies")) choice = "yes";
      else if (id.endsWith("_alternatives")) choice = "permitted";
      else if (id.endsWith("_qualifiers"))
        choice = p.component === "pipe" ? "q0" : "none";
      else if (id.includes("_join_"))
        choice = id.endsWith("_range")
          ? "all"
          : p.component === "fittings"
            ? "yes"
            : "no";
      else if (id.endsWith("_range"))
        choice =
          Object.entries(q.criteria).find(
            ([, label]) =>
              typeof label === "string" &&
              (p.material?.includes("carbon")
                ? label.startsWith("over")
                : label.startsWith("up to")),
          )?.[0] ?? "unclear";
      else if (p.component === "pipe") choice = "yes";
      return [id, { type: "choice" as const, choice, confidence: 0.99 }];
    }),
  ),
});
describe("specification assessment", () => {
  it("distinguishes strict boundaries from inclusive thresholds", () => {
    expect(sizeRanges("2 inches and smaller")[0]?.range).toMatchObject({
      max: 2,
      maxInclusive: true,
    });
    expect(sizeRanges("2 inches above")[0]?.range).toMatchObject({
      min: 2,
      minInclusive: false,
    });
    expect(sizeRanges("2 inches below")[0]?.range).toMatchObject({
      max: 2,
      maxInclusive: false,
    });
    expect(sizeRanges("over 50 mm")[0]?.range).toMatchObject({
      min: 50,
      minInclusive: false,
      unit: "mm",
    });
    expect(sizeRanges("1/2 to 2 inches")[0]?.range).toMatchObject({
      min: 0.5,
      max: 2,
    });
  });
  it("retains evidence, permitted alternatives, material size scopes and joining independently", async () => {
    const passages = specificationPassages(source, {
      pages: [{ page: 9, text }],
      warnings: [],
    });
    const result = await assessPassages(passages, [], fixture);
    const req = result.systems[0]!.requirements;
    expect(req.systemName).toBe("Hydronic heating");
    expect(req.rules.filter((r) => r.group === "pipe")).toHaveLength(2);
    const small = req.rules.find(
      (r) => r.group === "pipe" && r.sizeRange.max === 2,
    )!;
    expect(small.alternatives.map((a) => a.label).sort()).toEqual([
      "copper",
      "stainless steel",
    ]);
    expect(small.selectedAlternativeId).toBeNull();
    expect(req.rules.find((r) => r.group === "joining")).toMatchObject({
      appliesTo: ["fittings"],
      alternatives: [{ requiredTerms: ["threaded"] }],
    });
    expect(req.applicabilityEvidence[0]).toMatchObject({
      documentId: source.documentId,
      versionId: source.versionId,
      page: 9,
      section: "HEATING WATER PIPING",
    });
    expect(text.includes(req.applicabilityEvidence[0]!.quote)).toBe(true);
    const mapped = jobSystemRequirementsSchema.parse(req);
    for (const r of mapped.rules) {
      r.reviewStatus = "approved";
      r.alternatives = r.alternatives.map((a) =>
        mapSystemAlternative(a, {
          materials: [
            { id: id(3), name: "copper" },
            { id: id(4), name: "stainless steel" },
            { id: id(5), name: "carbon steel" },
          ],
          categories: [],
          catalogs: [],
        }),
      );
    }
    const unresolved = resolveSystemRequirements(mapped, {
      group: "pipe",
      size: { unit: "in", nominal: 2 },
    });
    expect(
      unresolved.issues.some((i) => i.code === "alternative_required"),
    ).toBe(true);
    mapped.rules.find((r) => r.id === small.id)!.selectedAlternativeId =
      small.alternatives.find((a) => a.label === "copper")!.id;
    expect(
      resolveSystemRequirements(mapped, {
        group: "pipe",
        size: { unit: "in", nominal: 2 },
      }).status,
    ).toBe("ready");
    expect(
      resolveSystemRequirements(mapped, {
        group: "pipe",
        size: { unit: "in", nominal: 2.5 },
      }).alternative?.materialLabel,
    ).toBe("carbon steel");
  });
  it("rejects negated/uncertain applicability and flags source association gaps", async () => {
    const passages = specificationPassages(source, {
      pages: [{ page: 1, text: "GENERAL\nPipe and fittings shall be copper." }],
      warnings: [],
    });
    const result = await assessPassages(passages, [], fixture);
    expect(result.systems).toEqual([]);
    expect(result.warnings[0]).toContain("could not be associated");
    const no: Evaluator = async (_s, q) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.keys(q).map((id) => [
          id,
          { type: "choice", choice: "no", confidence: 0.99 },
        ]),
      ),
    });
    expect(
      (
        await assessPassages(
          specificationPassages(source, {
            pages: [{ page: 1, text }],
            warnings: [],
          }),
          [],
          no,
        )
      ).systems,
    ).toEqual([]);
  });
  it("retains generic steel pipe when stainless steel valves occur in the same passage", async () => {
    const run: Evaluator = async (_s, questions) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, q]) => {
          const p = q.instructions as { component?: string; material?: string };
          let choice = "no";
          if (key.endsWith("_applies")) choice = "yes";
          else if (key.endsWith("_range")) choice = "all";
          else if (key.endsWith("_alternatives")) choice = "separate";
          else if (
            (p.component === "pipe" && p.material === "steel") ||
            (p.component === "valves" && p.material === "stainless steel")
          )
            choice = "yes";
          return [key, { type: "choice" as const, choice, confidence: 0.99 }];
        }),
      ),
    });
    const output = await assessPassages(
      specificationPassages(source, {
        pages: [
          {
            page: 1,
            text: "HEATING WATER PIPING\nSteel pipe shall be used. Stainless steel ball valves shall be used.",
          },
        ],
        warnings: [],
      }),
      [],
      run,
    );
    expect(
      output.systems[0]?.requirements.rules.find((r) => r.group === "pipe")
        ?.alternatives[0]?.label,
    ).toBe("steel");
    expect(
      output.systems[0]?.requirements.rules.find((r) => r.group === "valves")
        ?.alternatives[0]?.label,
    ).toBe("stainless steel");
  });
  it("keeps ball and check valve clauses in distinct scopes across pages", async () => {
    const run: Evaluator = async (_s, q) => ({
      model: "test",
      answers: Object.fromEntries(
        Object.entries(q).map(([key, v]) => {
          const p = v.instructions as { component?: string };
          const choice = key.endsWith("_range")
            ? "all"
            : key.endsWith("_applies") || p.component === "valves"
              ? "yes"
              : "no";
          return [key, { type: "choice" as const, choice, confidence: 0.99 }];
        }),
      ),
    });
    const out = await assessPassages(
      specificationPassages(source, {
        pages: [
          {
            page: 1,
            text: "HEATING WATER PIPING\nBronze ball valves are required.",
          },
          { page: 2, text: "Bronze check valves are required." },
        ],
        warnings: [],
      }),
      [],
      run,
    );
    expect(
      out.systems[0]?.requirements.rules.map((r) => r.componentTerms),
    ).toEqual([["ball valve"], ["check valve"]]);
  });
  it("splits provider requests into bounded chunks without dropping independent questions", async () => {
    let calls = 0;
    const run: Evaluator = async (state, questions) => {
      calls++;
      expect(JSON.stringify(questions).length).toBeLessThan(23000);
      return fixture(state, questions);
    };
    await assessPassages(
      specificationPassages(source, {
        pages: [
          {
            page: 1,
            text: text + "\nValves are brass, bronze, steel, PVC and CPVC.",
          },
        ],
        warnings: [],
      }),
      [],
      run,
    );
    expect(calls).toBeGreaterThan(1);
  });
});

it("recognizes drawing service labels without inventing material rules", async () => {
  const drawing = {
    setId: id(3),
    sheetId: id(1),
    sourceSheetId: id(2),
    imageUrl: "/synthetic",
    jobId: id(4),
  };
  const passages = specificationPassages(
    { ...source, drawing },
    {
      pages: [
        {
          page: 7,
          text: "PIPING LEGEND\nDCW - DOMESTIC COLD WATER\nDHW - DOMESTIC HOT WATER",
        },
      ],
      warnings: [],
    },
  );
  expect(passages.flatMap((p) => p.systems.map((s) => s.code))).toContain(
    "DCW",
  );
  const result = await assessPassages(passages, [], fixture);
  const cold = result.systems.find((s) => s.code === "DCW")!.requirements;
  expect(cold.applicabilityEvidence[0]?.drawing).toEqual({
    setId: id(3),
    sheetId: id(1),
    sourceSheetId: id(2),
  });
  expect(cold.rules).toHaveLength(0);
  expect(
    cold.issues.some(
      (i) => i.code === "drawing_applicability" && i.blocking && !i.resolved,
    ),
  ).toBe(true);
});
