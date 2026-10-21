/** Explicit synthetic-only smoke test. Never reads a customer's document or database. */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { config } from "dotenv";
if (process.env.RUN_REAL_SYSTEMS_ASSESSMENT !== "1")
  throw Error(
    "Set RUN_REAL_SYSTEMS_ASSESSMENT=1 to send the synthetic fixture to the configured provider.",
  );
config({ path: ".env", quiet: true });
if (!process.env.TYPESAFE_API_KEY)
  throw Error(
    "No TypeSafe API key configured; live provider validation cannot run.",
  );
const directory = await mkdtemp(path.join(tmpdir(), "foreman-systems-smoke-"));
try {
  process.env.JOB_DOCUMENT_STORAGE_ROOT = directory;
  const org = "00000000-0000-4000-8000-000000000001";
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const lines = [
    "SECTION 23 21 13 - HEATING WATER PIPING",
    "This project includes a hydronic heating water system.",
    "Pipe up to and including 2 inches shall be Type L copper.",
    "Pipe over 2 inches shall be Schedule 40 carbon steel.",
    "All heating water fittings shall be carbon steel with threaded joints.",
    "All heating water ball valves shall be bronze.",
  ];
  lines.forEach((text, i) =>
    page.drawText(text, { x: 40, y: 740 - i * 24, size: 12, font }),
  );
  const bytes = await pdf.save(),
    sha = createHash("sha256").update(bytes).digest("hex");
  const folder = path.join(directory, org, sha.slice(0, 2));
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, sha), bytes);
  const { extractSpecification } =
    await import("../src/server/job-systems/extract");
  const { assessPassages, specificationPassages } =
    await import("../src/server/job-systems/analyze");
  const { mapSystemAlternative, resolveSystemRequirements } =
    await import("../src/lib/job-systems");
  const source = {
    documentId: "00000000-0000-4000-8000-000000000002",
    versionId: "00000000-0000-4000-8000-000000000003",
    name: "Synthetic heating fixture.pdf",
    mimeType: "application/pdf",
    sha256: sha,
  };
  const extracted = await extractSpecification(org, source);
  const passages = specificationPassages(source, extracted);
  const result = await assessPassages(passages, [
    "copper",
    "carbon steel",
    "bronze",
  ]);
  const system = result.systems.find((s) => s.code === "HTG");
  if (!system) throw Error("Synthetic heating system was not identified.");
  const material = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (const rule of system.requirements.rules) {
    rule.reviewStatus = "approved";
    rule.alternatives = rule.alternatives.map((a) =>
      mapSystemAlternative(a, {
        materials: [
          { id: material(10), name: "copper" },
          { id: material(11), name: "carbon steel" },
          { id: material(12), name: "bronze" },
        ],
        categories: [],
        catalogs: [],
      }),
    );
  }
  const small = resolveSystemRequirements(
    system.requirements,
    { group: "pipe", size: { nominal: 2, unit: "in" } },
    [{ documentId: source.documentId, versionId: source.versionId }],
  );
  const large = resolveSystemRequirements(
    system.requirements,
    { group: "pipe", size: { nominal: 2.5, unit: "in" } },
    [{ documentId: source.documentId, versionId: source.versionId }],
  );
  console.log(
    JSON.stringify(
      {
        syntheticOnly: true,
        model: result.model,
        pages: extracted.pages.length,
        systems: result.systems.length,
        rules: system.requirements.rules.map((r) => ({
          group: r.group,
          size: r.sizeRange,
          alternatives: r.alternatives.map((a) => a.label),
        })),
        at2in: {
          status: small.status,
          material: small.alternative?.materialLabel,
          issues: small.issues.map((i) => i.code),
        },
        at2_5in: {
          status: large.status,
          material: large.alternative?.materialLabel,
          issues: large.issues.map((i) => i.code),
        },
        warnings: [...extracted.warnings, ...result.warnings],
      },
      null,
      2,
    ),
  );
  if (
    small.status !== "ready" ||
    small.alternative?.materialLabel !== "copper" ||
    large.status !== "ready" ||
    large.alternative?.materialLabel !== "carbon steel"
  )
    throw Error(
      "Synthetic size-boundary material mapping was not confirmed by the provider.",
    );
} finally {
  await rm(directory, { recursive: true, force: true });
}
