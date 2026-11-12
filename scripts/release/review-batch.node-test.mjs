import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReviewedBatch } from "./review-batch.mjs";
const now = Date.parse("2026-11-12T12:00:00.000Z");
const expected = {
  candidateBuild: "a".repeat(64),
  candidateSourceFingerprint: "b".repeat(64),
  reportSha256: "c".repeat(64),
};
const fixture = () => ({
  version: 1, batchId: "receiving-web", status: "reviewed",
  reviewedAt: "2026-11-12T11:59:00.000Z",
  candidate: { build: expected.candidateBuild, sourceFingerprint: expected.candidateSourceFingerprint, reportSha256: expected.reportSha256 },
  findings: [],
});
test("accepts an explicitly reviewed exact candidate without mutating evidence", () => {
  const batch = fixture(), before = structuredClone(batch);
  const result = validateReviewedBatch(batch, expected, now);
  assert.deepEqual(batch, before);
  assert.equal(result.batchId, batch.batchId);
  assert.equal(result.reportSha256, expected.reportSha256);
  assert.equal(result.openSeriousFindings, 0);
});
test("rejects absent, waiting, malformed and incomplete review records", () => {
  for (const batch of [undefined, {}, { ...fixture(), version: 2 }, { ...fixture(), batchId: " " },
    { ...fixture(), status: "waiting" }, { ...fixture(), status: "reviewed with no finding" },
    { ...fixture(), findings: undefined }, { ...fixture(), findings: {} }])
    assert.throws(() => validateReviewedBatch(batch, expected, now));
});
test("each build, fingerprint and raw report hash must match the checked promotion", () => {
  for (const field of ["build", "sourceFingerprint", "reportSha256"]) {
    const changed = fixture(); changed.candidate[field] = "d".repeat(64);
    assert.throws(() => validateReviewedBatch(changed, expected, now), /differs/);
    changed.candidate[field] = "not-a-sha";
    assert.throws(() => validateReviewedBatch(changed, expected, now), /differs/);
  }
  assert.throws(() => validateReviewedBatch(fixture(), { ...expected, reportSha256: undefined }, now), /differs/);
});
test("an open serious finding blocks even when another serious finding was resolved", () => {
  const batch = fixture();
  batch.findings = [{ id: "fixed", severity: "serious", status: "resolved" }, { id: "still-broken", severity: "serious", status: "open" }];
  assert.throws(() => validateReviewedBatch(batch, expected, now), /still-broken/);
});
test("resolved serious and open minor findings do not imply an open serious finding", () => {
  const batch = fixture();
  batch.findings = [{ id: "fixed", severity: "serious", status: "resolved" }, { id: "minor", severity: "minor", status: "open" }, { id: "note", severity: "info", status: "open" }];
  assert.equal(validateReviewedBatch(batch, expected, now).findingCount, 3);
});
test("unknown severity/status or duplicate finding IDs cannot hide a serious issue", () => {
  for (const findings of [[null], [{ id: "x", severity: "critical", status: "open" }],
    [{ id: "x", severity: "serious", status: "dismissed" }], [{ id: "", severity: "minor", status: "open" }],
    [{ id: "x", severity: "minor", status: "open" }, { id: "x", severity: "serious", status: "resolved" }]])
    assert.throws(() => validateReviewedBatch({ ...fixture(), findings }, expected, now), /invalid finding/);
});
test("review time must be real and completed rather than future or omitted", () => {
  for (const reviewedAt of [undefined, null, "", "not-a-date", "2026-11-12T12:00:00.001Z"])
    assert.throws(() => validateReviewedBatch({ ...fixture(), reviewedAt }, expected, now), /review time/);
  assert.doesNotThrow(() => validateReviewedBatch({ ...fixture(), reviewedAt: new Date(now).toISOString() }, expected, now));
});
