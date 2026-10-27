// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  allowed: true,
  visible: true,
  files: new Map<string, unknown>(),
  reads: vi.fn(),
  currentVersion: "00000000-0000-4000-8000-000000000004",
}));
vi.mock("node:fs/promises", () => ({
  readFile: async (file: string) => {
    fixture.reads(file);
    if (!fixture.files.has(file))
      throw Object.assign(Error("Missing"), { code: "ENOENT" });
    return Buffer.from(JSON.stringify(fixture.files.get(file)));
  },
}));
vi.mock("~/server/documents/storage", () => ({
  documentStorageRoot: "/trial-test",
}));
vi.mock("~/server/auth/permissions", () => ({
  userCan: () => fixture.allowed,
}));
vi.mock("~/server/documents/access", () => ({ documentActor: () => ({}) }));
vi.mock("~/server/documents/domain", () => ({
  accessibleDocument: (_: unknown, __: unknown, id: string) => {
    if (!fixture.visible) throw Error("No document access");
    return { id, currentVersionId: fixture.currentVersion };
  },
}));
vi.mock("~/server/documents/service", () => ({
  readWorkspace: async () => ({
    versions: [
      {
        id: "00000000-0000-4000-8000-000000000004",
        documentId: "00000000-0000-4000-8000-000000000003",
        sha256: "a".repeat(64),
      },
    ],
  }),
}));
import { trialDocument, trialIndex } from "./trial-store";
import type { DocumentAccess } from "~/server/documents/access";
const org = "00000000-0000-4000-8000-000000000001",
  job = "00000000-0000-4000-8000-000000000002",
  doc = "00000000-0000-4000-8000-000000000003",
  version = "00000000-0000-4000-8000-000000000004",
  run = "trial-test-001";
const access = {
  job: { id: job, organizationId: org },
  user: { id: "reviewer" },
} as DocumentAccess;
const base = `/trial-test/.packing-trials/${org}/${job}`;
const index = {
  schemaVersion: 1,
  runId: run,
  jobId: job,
  organizationId: org,
  createdAt: "2026-10-27",
  updatedAt: "2026-10-27",
  cases: [
    {
      caseId: "case-001",
      documentId: doc,
      versionId: version,
      sha256: "a".repeat(64),
      pages: 1,
      name: "Slip",
    },
  ],
};
beforeEach(() => {
  fixture.allowed = true;
  fixture.visible = true;
  fixture.currentVersion = version;
  fixture.files.clear();
  fixture.reads.mockClear();
  fixture.files.set(`${base}/latest.json`, { runId: run });
  fixture.files.set(`${base}/${run}/index.json`, index);
});
describe("private trial storage", () => {
  it("rejects readers without receiving permission before reading a result", async () => {
    fixture.allowed = false;
    await expect(trialIndex(access)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(fixture.reads).not.toHaveBeenCalled();
  });
  it("rejects path traversal and foreign-job manifests", async () => {
    await expect(trialIndex(access, "../another-job")).rejects.toThrow();
    expect(fixture.reads).not.toHaveBeenCalled();
    fixture.files.set(`${base}/${run}/index.json`, { ...index, jobId: org });
    await expect(trialIndex(access)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("checks document permissions before exposing a trial", async () => {
    fixture.visible = false;
    await expect(trialDocument(access, doc)).rejects.toThrow(
      "No document access",
    );
    expect(fixture.reads).not.toHaveBeenCalled();
  });
  it("rejects a result for different source pixels", async () => {
    fixture.files.set(`${base}/${run}/results/ocr/case-001.json`, {
      schemaVersion: 1,
      caseId: "case-001",
      reader: "ocr",
      model: "OCR",
      status: "complete",
      sourceSha256: "b".repeat(64),
      lines: [],
      warnings: [],
    });
    await expect(trialDocument(access, doc)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("marks old-version results stale while preserving read access to their source", async () => {
    fixture.currentVersion = org;
    expect(await trialDocument(access, doc)).toMatchObject({
      stale: true,
      entry: { versionId: version },
    });
  });
});
