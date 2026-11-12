// Production promotion only. Dev deployment records a waiting queue entry and
// never invokes this validator. Full timing/byte validation remains separate.
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === "string" && value.trim().length > 0;
export function validateReviewedBatch(batch, expected, now = Date.now()) {
  if (batch?.version !== 1 || !text(batch.batchId) || batch.status !== "reviewed")
    throw Error("Production promotion requires an explicitly reviewed batch");
  const reviewedAt = Date.parse(batch.reviewedAt);
  if (!text(batch.reviewedAt) || !Number.isFinite(reviewedAt) || !Number.isFinite(now) || reviewedAt > now)
    throw Error("Reviewed batch needs a valid completed review time");
  for (const [field, value] of [
    ["build", expected?.candidateBuild],
    ["sourceFingerprint", expected?.candidateSourceFingerprint],
    ["reportSha256", expected?.reportSha256],
  ]) {
    if (!sha(value) || !sha(batch.candidate?.[field]) || batch.candidate[field] !== value)
      throw Error("Reviewed batch candidate " + field + " differs from promotion evidence");
  }
  if (!Array.isArray(batch.findings))
    throw Error("Reviewed batch requires an explicit findings list");
  const ids = new Set();
  for (const finding of batch.findings) {
    if (!text(finding?.id) || ids.has(finding.id) ||
        !["info", "minor", "serious"].includes(finding.severity) ||
        !["open", "resolved"].includes(finding.status))
      throw Error("Reviewed batch contains a duplicate or invalid finding");
    ids.add(finding.id);
    if (finding.severity === "serious" && finding.status === "open")
      throw Error("Production promotion blocked by open serious finding: " + finding.id);
  }
  return {
    batchId: batch.batchId,
    reviewedAt: batch.reviewedAt,
    candidateBuild: expected.candidateBuild,
    candidateSourceFingerprint: expected.candidateSourceFingerprint,
    reportSha256: expected.reportSha256,
    findingCount: batch.findings.length,
    openSeriousFindings: 0,
  };
}
