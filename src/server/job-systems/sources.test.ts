// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
vi.mock("~/server/db", () => ({ db: {} }));
import {
  specificationSources,
  sourceFingerprint,
  redactSystemRequirements,
} from "./sources";
import { emptyDocumentState } from "../documents/domain";
import type { DocumentAccess } from "../documents/access";
import { jobSystemRequirementsSchema } from "~/lib/job-systems";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const access = {
  job: { id: id(1) },
  user: { id: "viewer" },
  canWrite: false,
  canManage: false,
} as DocumentAccess;
describe("specification sources", () => {
  it("includes nested sources and current immutable versions, respecting folder access and deleted files", () => {
    const state = emptyDocumentState();
    const now = new Date().toISOString();
    state.folders = [
      {
        id: id(2),
        parentId: null,
        name: "Specifications",
        permissions: [],
        createdBy: "owner",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(3),
        parentId: id(2),
        name: "Mechanical",
        permissions: [],
        createdBy: "owner",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: id(4),
        parentId: id(2),
        name: "Private",
        permissions: [{ userId: "owner", role: "viewer" }],
        createdBy: "owner",
        createdAt: now,
        updatedAt: now,
      },
    ];
    for (let n = 5; n < 8; n++) {
      state.documents.push({
        id: id(n),
        jobId: id(1),
        name: `Spec ${n}`,
        folderId: n === 7 ? id(4) : id(3),
        currentVersionId: id(n + 10),
        description: "",
        tags: [],
        status: "draft",
        officeWebUrl: null,
        lockedBy: null,
        deletedAt: n === 6 ? now : null,
        createdBy: "owner",
        createdAt: now,
        updatedAt: now,
      });
      state.versions.push({
        id: id(n + 10),
        documentId: id(n),
        number: 1,
        name: "spec.pdf",
        size: 1,
        mimeType: "application/pdf",
        sha256: "a".repeat(64),
        createdBy: "owner",
        createdAt: now,
        restoredFromVersionId: null,
      });
    }
    const context = specificationSources(state, access);
    expect(context.sources.map((s) => s.documentId)).toEqual([id(5)]);
    expect(context.folderId).toBe(id(2));
    expect(sourceFingerprint(context.sources)).not.toEqual(
      sourceFingerprint([{ ...context.sources[0]!, versionId: id(90) }]),
    );
  });
  it("redacts the complete derived requirement when any citation is restricted", () => {
    const req = jobSystemRequirementsSchema.parse({
      systemName: "Secret system",
      sourceVersions: [{ documentId: id(5), versionId: id(15) }],
    });
    expect(redactSystemRequirements(req, new Set()).systemName).toBe(
      "Restricted system specification",
    );
    expect(redactSystemRequirements(req, new Set([id(5)]))).toEqual(req);
  });
});
