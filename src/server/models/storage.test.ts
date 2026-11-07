// @vitest-environment node
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelAccess } from "./access";
let root: string, storage: typeof import("./storage");
const org = crypto.randomUUID(),
  job = crypto.randomUUID();
const access = {
  job: { id: job, organizationId: org },
  user: { id: "owner" },
} as ModelAccess;
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "fhq-bim-test-"));
  vi.stubEnv("BIM_STORAGE_ROOT", root);
  storage = await import("./storage");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
describe("immutable bounded model uploads", () => {
  it("scopes sessions to user, job and organization; rejects altered chunks and incomplete data", async () => {
    const bytes = Buffer.from(
      "ISO-10303-21;\nHEADER;FILE_SCHEMA(('IFC2X3'));ENDSEC;DATA;ENDSEC;END-ISO-10303-21;",
    );
    const session = await storage.startModelUpload(access, {
      jobId: job,
      name: "Model",
      filename: "../../model.ifc",
      size: bytes.length,
      discipline: "coordination",
    });
    await expect(
      storage.writeModelChunk(
        { ...access, user: { id: "outsider" } } as ModelAccess,
        session.id,
        0,
        bytes,
      ),
    ).rejects.toThrow();
    await expect(
      storage.writeModelChunk(
        {
          ...access,
          job: { ...access.job, organizationId: crypto.randomUUID() },
        } as ModelAccess,
        session.id,
        0,
        bytes,
      ),
    ).rejects.toThrow();
    await expect(storage.finishModelUpload(access, session.id)).rejects.toThrow(
      "incomplete",
    );
    await storage.writeModelChunk(access, session.id, 0, bytes);
    await storage.writeModelChunk(access, session.id, 0, bytes);
    await expect(
      storage.writeModelChunk(
        access,
        session.id,
        0,
        Buffer.alloc(bytes.length),
      ),
    ).rejects.toThrow("changed");
    const one = await storage.finishModelUpload(access, session.id);
    const two = await storage.finishModelUpload(access, session.id);
    expect(one.sha).toBe(two.sha);
    expect(one.metadata.filename).toBe("model.ifc");
    expect(await readFile(storage.modelBlobPath(org, one.sha))).toEqual(bytes);
  });
  it("rejects path traversal, disguised files and unsupported formats", () => {
    expect(() => storage.modelBlobPath("../escape", "a".repeat(64))).toThrow();
    expect(() => storage.modelBlobPath(org, "../escape")).toThrow();
    expect(() => storage.modelFormat("model.exe")).toThrow();
    expect(() =>
      storage.validateModelHeader(Buffer.from("<html>"), "ifc"),
    ).toThrow();
    expect(() => storage.validateModelHeader(Buffer.alloc(8), "rvt")).toThrow();
  });
});
