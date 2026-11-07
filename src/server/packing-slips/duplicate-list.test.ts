import { describe, expect, it } from "vitest";
import { duplicateList } from "./duplicate-list";
import type { DocumentState, JobDocument } from "~/server/documents/types";

const current = { id: "current", currentVersionId: "v1" } as JobDocument;
function candidates(extra: Partial<JobDocument> = {}) {
  const other = { id: "other", name: "Earlier slip", currentVersionId: "v2", ...extra } as JobDocument;
  const state = {
    documents: [current, other],
    versions: [{ id: "v1", sha256: "same" }, { id: "v2", sha256: "same" }],
  } as DocumentState;
  return duplicateList(state, current);
}
describe("duplicate candidates", () => {
  it("keeps a live matching scan", () => {
    expect(candidates()).toMatchObject([{ id: "other", received: false }]);
  });
  it("ignores recycled scans without receipts", () => {
    expect(candidates({ deletedAt: "2026-11-06" })).toEqual([]);
  });
  it("retains recycled scans with approved receipts to prevent double receiving", () => {
    expect(candidates({ deletedAt: "2026-11-06", receivingReview: { lines: [{ approved: { quantity: 2 } }] } as JobDocument["receivingReview"] })).toMatchObject([{ id: "other", received: true }]);
  });
  it("ignores the scan explicitly replaced by the current one", () => {
    expect(candidates({ receivingReview: { retiredBy: "current" } as JobDocument["receivingReview"] })).toEqual([]);
  });
});
