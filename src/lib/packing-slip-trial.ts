import { z } from "zod";
import { receiptUnit } from "./packing-slip-review";

export const trialReaders = ["ocr", "jev", "terra", "astra"] as const;
export type TrialReader = (typeof trialReaders)[number];
export const readerLabels: Record<TrialReader, string> = {
  ocr: "OCR only",
  jev: "Jev Image",
  terra: "Terra 6.1",
  astra: "Astra Max",
};
const bounded = z.string().max(10000);
export const trialScoreSchema = z.object({
  value: z.number().finite().min(0).max(1),
  basis: z.string().max(80),
  reason: bounded,
});
const amount = z.number().finite().min(-999999).max(999999).nullable();
const box = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
  })
  .nullable();
export const trialLineSchema = z
  .object({
    lineId: z.string().max(100),
    page: z.number().int().min(1).max(100),
    box,
    evidence: bounded,
    description: bounded,
    sku: z.string().max(500).nullable(),
    ordered: amount,
    shipped: amount,
    backordered: amount,
    unit: z.string().max(100).nullable(),
    unitPrice: amount,
    orderItemId: z.uuid().nullable(),
    matchedDescription: bounded.optional(),
    confidence: z.object({
      part: trialScoreSchema,
      quantity: trialScoreSchema,
      match: trialScoreSchema,
      overall: trialScoreSchema,
    }),
    issues: z.array(bounded).max(100),
  })
  .passthrough();
export const trialResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    caseId: z.string().regex(/^case-\d{3,6}$/),
    reader: z.enum(trialReaders),
    model: z.string().max(200),
    reasoning: z.string().max(100).nullable().optional(),
    status: z.enum(["complete", "failed"]),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    artifactSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    runId: z.uuid().optional(),
    durationMs: z.number().nonnegative().optional(),
    pagesRead: z.array(z.number().int().positive()).optional(),
    documentKind: z
      .enum(["delivery", "return", "credit", "other", "unclear"])
      .optional(),
    supplierName: bounded.optional(),
    deliveryNumber: bounded.optional(),
    supplierOrderNumber: bounded.optional(),
    deliveryDate: bounded.optional(),
    orderId: z.uuid().nullable().optional(),
    orderLabel: bounded.optional(),
    orderConfidence: trialScoreSchema.optional(),
    lines: z.array(trialLineSchema).max(1000),
    warnings: z.array(bounded).max(300),
    error: bounded.optional(),
    usage: z.unknown().optional(),
  })
  .passthrough();
export type TrialScore = z.infer<typeof trialScoreSchema>;
export type TrialLine = z.infer<typeof trialLineSchema>;
export type TrialResult = z.infer<typeof trialResultSchema>;
export type TrialResults = Partial<Record<TrialReader, TrialResult>>;
export type TrialRow = {
  id: string;
  page: number;
  lines: Partial<Record<TrialReader, TrialLine>>;
};
export const trialIndexSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
  jobId: z.uuid(),
  organizationId: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  cases: z
    .array(
      z.object({
        caseId: z.string().regex(/^case-\d{3,6}$/),
        documentId: z.uuid(),
        versionId: z.uuid(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        pages: z.number().int().positive().max(100),
        name: z.string().max(1000),
        readers: z
          .record(
            z.enum(trialReaders),
            z.enum(["pending", "complete", "failed"]),
          )
          .optional(),
      }),
    )
    .max(10000),
});
export type TrialIndex = z.infer<typeof trialIndexSchema>;
export const trialKey = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
function proximity(a: TrialLine, b: TrialLine) {
  if (a.page !== b.page) return 0;
  let overlap = 0;
  if (a.box && b.box) {
    const shared = Math.max(
      0,
      Math.min(a.box.y + a.box.height, b.box.y + b.box.height) -
        Math.max(a.box.y, b.box.y),
    );
    overlap = shared / Math.max(0.001, Math.min(a.box.height, b.box.height));
    // Repeated SKUs on different source rows must stay separate.
    if (!shared && Math.abs(a.box.y - b.box.y) > 0.08) return 0;
  }
  const sku = trialKey(a.sku),
    other = trialKey(b.sku);
  let score = overlap >= 0.65 ? 2 + overlap : 0;
  if (sku.length > 2 && sku === other) score += 3;
  if (
    a.orderItemId &&
    a.orderItemId === b.orderItemId &&
    (!sku || !other || sku === other)
  )
    score += 1.5;
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9/]+/g, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
  const x = words(a.description),
    y = words(b.description);
  const common = [...x].filter((w) => y.has(w)).length;
  const union = new Set([...x, ...y]).size;
  if (common >= 2 && union && common / union >= 0.65) score += 1.3;
  return score;
}
/** Alignment is for inspection, never an answer key or an automatic receipt. */
export function alignTrialLines(results: TrialResults): TrialRow[] {
  const rows: TrialRow[] = [];
  // Rich transcriptions form anchors; unmatched detections from every reader remain visible.
  for (const reader of ["astra", "terra", "ocr", "jev"] as const) {
    const lines = results[reader]?.lines ?? [];
    const pairs = lines
      .flatMap((line, i) =>
        rows.flatMap((row, j) => {
          if (row.lines[reader]) return [];
          const score = Math.max(
            0,
            ...Object.values(row.lines).map((other) => proximity(line, other)),
          );
          return score >= 1.3 ? [{ i, j, score }] : [];
        }),
      )
      .sort((a, b) => b.score - a.score);
    const used = new Set<number>(),
      taken = new Set<number>();
    for (const p of pairs) {
      if (used.has(p.i) || taken.has(p.j)) continue;
      rows[p.j]!.lines[reader] = lines[p.i]!;
      used.add(p.i);
      taken.add(p.j);
    }
    lines.forEach((line, i) => {
      if (!used.has(i))
        rows.push({
          id: `${reader}:${line.lineId}`,
          page: line.page,
          lines: { [reader]: line },
        });
    });
  }
  const y = (r: TrialRow) =>
    Object.values(r.lines).find((l) => l.box)?.box?.y ?? 1;
  return rows.sort((a, b) => a.page - b.page || y(a) - y(b));
}
export function trialDisagreements(row: TrialRow, results: TrialResults) {
  const lines = Object.values(row.lines);
  const issues: string[] = [];
  if (
    trialReaders.some((r) => results[r]?.status === "complete" && !row.lines[r])
  )
    issues.push("Some readers did not detect this line");
  if (new Set(lines.map((l) => l.orderItemId ?? "unmatched")).size > 1)
    issues.push("Part matches differ");
  if (new Set(lines.map((l) => l.shipped)).size > 1)
    issues.push("Shipped quantities differ");
  if (new Set(lines.map((l) => receiptUnit(l.unit))).size > 1)
    issues.push("Units differ");
  if (new Set(lines.map((l) => l.backordered)).size > 1)
    issues.push("Backorder quantities differ");
  return issues;
}

/** Empirical bins use human-verified labels only. Predictions and model agreement never create labels. */
export function confidenceCalibration(
  samples: Array<{
    confidence: number;
    correct: boolean;
    humanVerified: boolean;
  }>,
) {
  return Array.from({ length: 10 }, (_, i) => {
    const group = samples.filter(
      (s) =>
        s.humanVerified &&
        Number.isFinite(s.confidence) &&
        s.confidence >= i / 10 &&
        (i === 9 ? s.confidence <= 1 : s.confidence < (i + 1) / 10),
    );
    const correct = group.filter((s) => s.correct).length;
    return {
      lower: i / 10,
      upper: (i + 1) / 10,
      count: group.length,
      correct,
      accuracy: group.length ? correct / group.length : null,
    };
  });
}
