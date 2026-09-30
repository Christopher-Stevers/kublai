import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { sourceDrawingHash } from "./drawing-hash";

let directory: string;
const jobId = randomUUID(),
  uploadId = randomUUID();
const floor = {
  jobId,
  imageUrl: `/api/job-rooms/files/${jobId}/${uploadId}/floor-18.webp`,
};
const expected = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "room-review-hash-"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
async function source(bytes: string) {
  const parent = path.join(
    directory,
    "uploads",
    "job-floor-plans",
    jobId,
    uploadId,
  );
  await mkdir(parent, { recursive: true });
  await writeFile(path.join(parent, "plan.pdf"), bytes);
}
describe("review-time drawing fingerprints", () => {
  it("hashes actual source bytes and detects a changed source instead of reusing the old fingerprint", async () => {
    await source("first PDF bytes");
    expect(await sourceDrawingHash(floor)).toBe(expected("first PDF bytes"));
    expect(await sourceDrawingHash(floor)).toBe(expected("first PDF bytes"));
    await source("a replacement PDF with different bytes");
    expect(await sourceDrawingHash(floor)).toBe(
      expected("a replacement PDF with different bytes"),
    );
  });
  it("shares simultaneous reads while preserving the same source identity", async () => {
    await source("shared PDF bytes");
    expect(
      await Promise.all(
        Array.from({ length: 10 }, () => sourceDrawingHash(floor)),
      ),
    ).toEqual(Array.from({ length: 10 }, () => expected("shared PDF bytes")));
  });
  it("missing legacy sources remain unverified and can acquire provenance after restoration", async () => {
    expect(await sourceDrawingHash(floor)).toBeNull();
    await source("restored source");
    expect(await sourceDrawingHash(floor)).toBe(expected("restored source"));
  });
  it("does not read escaped, cross-job or external storage URLs", async () => {
    await source("private source");
    for (const imageUrl of [
      "https://example.com/plan.png",
      `/api/job-rooms/files/${jobId}/../plan.pdf`,
      `/api/job-rooms/files/${randomUUID()}/${uploadId}/floor-18.webp`,
    ])
      expect(await sourceDrawingHash({ jobId, imageUrl })).toBeNull();
  });
});
