import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DRAWING_ATTACHMENT_BYTES,
  readDrawingAttachment,
  withDrawingAttachmentSlot,
  writeDrawingAttachment,
} from "./attachments";
let directory: string;
const ids = {
  jobId: "0391aed4-7773-47ec-9141-09df373ec008",
  sheetId: "d814fc88-da7c-4df5-aa89-fe3c1fde0462",
  authorId: "user-one",
};
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "drawing-attachment-test-"));
  vi.spyOn(process, "cwd").mockReturnValue(directory);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
describe("drawing attachment storage", () => {
  it("re-encodes photos, sanitizes download names and binds them to sheet/author", async () => {
    const bytes = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const uploaded = await writeDrawingAttachment({
      ...ids,
      name: "../photo\r\n.png",
      bytes,
    });
    const saved = await readDrawingAttachment(
      ids.jobId,
      uploaded.url.split("/").at(-1)!,
    );
    expect(saved.mime).toBe("image/webp");
    expect(saved.name).not.toMatch(/[\r\n/\\]/);
    expect(saved.authorId).toBe(ids.authorId);
    expect(saved.sheetId).toBe(ids.sheetId);
    expect((await sharp(saved.bytes).metadata()).format).toBe("webp");
  });
  it("rejects executable/non-image input and oversized bodies", async () => {
    await expect(
      writeDrawingAttachment({
        ...ids,
        name: "attack.html",
        bytes: Buffer.from("<script>bad()</script>"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      writeDrawingAttachment({
        ...ids,
        name: "big.pdf",
        bytes: Buffer.alloc(MAX_DRAWING_ATTACHMENT_BYTES + 1),
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
  it("bounds concurrent processing and frees slots after completion/failure", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withDrawingAttachmentSlot(() => gate);
    const second = withDrawingAttachmentSlot(() => gate);
    await expect(
      withDrawingAttachmentSlot(async () => undefined),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    release();
    await Promise.all([first, second]);
    await expect(
      withDrawingAttachmentSlot(async () => {
        throw new Error("conversion failed");
      }),
    ).rejects.toThrow("conversion failed");
    await expect(withDrawingAttachmentSlot(async () => "ready")).resolves.toBe(
      "ready",
    );
  });
});
