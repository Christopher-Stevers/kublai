// @vitest-environment node
import {
  mkdtemp,
  mkdir,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as StorageModule from "./storage";

let root: string;
let directory: string;
let openFile: typeof StorageModule.openJobRoomFile;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "foreman-file-stream-test-"));
  directory = path.join(root, "uploads", "job-floor-plans");
  await mkdir(directory, { recursive: true });
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  try {
    ({ openJobRoomFile: openFile } = await import("./storage"));
  } finally {
    cwd.mockRestore();
  }
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function openHandles(filename: string) {
  const names = await readdir("/proc/self/fd");
  const paths = await Promise.all(
    names.map((name) => readlink(`/proc/self/fd/${name}`).catch(() => "")),
  );
  return paths.filter((value) => value === filename).length;
}

describe("private drawing streaming from local files", () => {
  it("streams only the requested bytes in chunks bounded to64KiB", async () => {
    const content = Buffer.alloc(240000);
    for (let index = 0; index < content.length; index++)
      content[index] = index % 251;
    const filename = path.join(directory, "range.pdf");
    await writeFile(filename, content);
    const file = await openFile("range.pdf");
    expect(file.size).toBe(content.length);
    expect(file.etag).toMatch(/^"[^\"]+"$/);
    expect(file.modified).toBeInstanceOf(Date);
    const reader = file.stream(123, 190000).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      expect(next.value.byteLength).toBeLessThanOrEqual(65536);
      chunks.push(next.value);
    }
    expect(Buffer.concat(chunks)).toEqual(content.subarray(123, 190001));
    expect(await openHandles(filename)).toBe(0);
  });

  it("closes the descriptor when a range fetch is cancelled mid-transfer", async () => {
    const filename = path.join(directory, "cancel.pdf");
    await writeFile(filename, Buffer.alloc(2 * 1024 * 1024, 7));
    const file = await openFile("cancel.pdf");
    expect(await openHandles(filename)).toBe(1);
    const reader = file.stream().getReader();
    expect((await reader.read()).value?.length).toBe(65536);
    await reader.cancel();
    await file.close(); // Explicit metadata cleanup and cancellation are idempotent.
    expect(await openHandles(filename)).toBe(0);
  });

  it("returns an empty stream and closes zero-byte files", async () => {
    const filename = path.join(directory, "empty.pdf");
    await writeFile(filename, "");
    const file = await openFile("empty.pdf");
    expect(file.size).toBe(0);
    expect(await new Response(file.stream()).text()).toBe("");
    expect(await openHandles(filename)).toBe(0);
  });

  it("changes validators when a legacy file is replaced with same-length content", async () => {
    await writeFile(path.join(directory, "legacy.pdf"), "one");
    const first = await openFile("legacy.pdf");
    await first.close();
    await writeFile(path.join(directory, "legacy.pdf"), "two");
    const second = await openFile("legacy.pdf");
    expect(second.etag).not.toBe(first.etag);
    expect(await new Response(second.stream()).text()).toBe("two");
  });

  it("rejects directories and missing files without leaking descriptors", async () => {
    await expect(openFile("missing.pdf")).rejects.toThrow();
    await expect(openFile(".")).rejects.toThrow("Invalid drawing file");
    expect(await openHandles(directory)).toBe(0);
  });

  it("fails a truncated transfer and closes the file instead of claiming a complete body", async () => {
    const filename = path.join(directory, "truncated.pdf");
    await writeFile(filename, "original bytes");
    const file = await openFile("truncated.pdf");
    await writeFile(filename, "");
    await expect(new Response(file.stream()).arrayBuffer()).rejects.toThrow(
      "Drawing file changed",
    );
    expect(await openHandles(filename)).toBe(0);
  });
});
