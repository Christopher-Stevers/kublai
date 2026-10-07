// @vitest-environment node
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as DocumentStorage from "./storage";
let storage: typeof DocumentStorage;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "job-documents-storage-"));
  vi.stubEnv("JOB_DOCUMENT_STORAGE_ROOT", root);
  storage = await import("./storage");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("Private immutable blob storage", () => {
  it("atomically publishes concurrent identical files with no partial or temporary files", async () => {
    const bytes = Buffer.alloc(1024 * 1024, 77);
    const hashes = await Promise.all(
      Array.from({ length: 5 }, () => storage.writeDocumentBlob(org, bytes)),
    );
    expect(new Set(hashes).size).toBe(1);
    const hash = hashes[0]!;
    expect(await storage.readDocumentBlob(org, hash)).toEqual(bytes);
    expect(await readdir(path.join(root, org, hash.slice(0, 2)))).toEqual([
      hash,
    ]);
    expect(
      (await stat(path.join(root, org, hash.slice(0, 2), hash))).mode & 0o777,
    ).toBe(0o600);
    await expect(
      storage.readDocumentBlob("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", hash),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("uses byte signatures for inline formats and sends executable text as download", () => {
    expect(
      storage.detectedDocumentMime(
        Buffer.from("<script>alert(1)</script>"),
        "image.png",
      ),
    ).toBe("application/octet-stream");
    expect(
      storage.detectedDocumentMime(
        Buffer.from("<svg onload='alert(1)'/>"),
        "graphic.svg",
      ),
    ).toBe("application/octet-stream");
    expect(
      storage.detectedDocumentMime(Buffer.from("%PDF-1.7\n"), "document.pdf"),
    ).toBe("application/pdf");
    expect(storage.safeDocumentName("../../a\\plan\u0000.pdf")).toBe(
      "plan.pdf",
    );
  });
  it("does not accept path traversal storage identifiers or empty files", async () => {
    await expect(
      storage.writeDocumentBlob("../../escape", Buffer.from("file")),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      storage.writeDocumentBlob(org, Buffer.alloc(0)),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(
      storage.readDocumentBlob(org, "../../secret"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
