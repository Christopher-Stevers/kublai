// @vitest-environment node
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

const root = await mkdtemp(path.join(os.tmpdir(), "foremanhq-thumbs-"));
vi.spyOn(process, "cwd").mockReturnValue(root);
const { openJobRoomThumbnail } = await import("./storage");

const job = "0391aed4-7773-47ec-9141-09df373ec008";
const upload = "b06815cb-ebac-42e0-8521-db654e9cad60";
const folder = path.join(root, "uploads", "job-floor-plans", job, upload);
const page = (width: number) =>
  sharp({
    create: { width, height: 1650, channels: 3, background: "#ffffff" },
  })
    .webp()
    .toBuffer();

beforeAll(async () => {
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "floor-1.webp"), await page(2200));
});
afterAll(() => rm(root, { recursive: true, force: true }));

async function readThumbnail() {
  const file = await openJobRoomThumbnail(`${job}/${upload}/floor-1.webp`);
  const chunks: Uint8Array[] = [];
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return { file, meta: await sharp(Buffer.concat(chunks)).metadata() };
}

test("makes a 640px copy once, reuses it, and remakes it when the page changes", async () => {
  const [first, again] = await Promise.all([readThumbnail(), readThumbnail()]);
  expect(first.meta.width).toBe(640);
  expect(first.meta.height).toBe(480);
  expect(again.file.etag).toBe(first.file.etag);
  expect((await readdir(folder)).sort()).toEqual([
    "floor-1.thumb-640.webp",
    "floor-1.webp",
  ]);
  expect((await readThumbnail()).file.etag).toBe(first.file.etag);

  await writeFile(path.join(folder, "floor-1.webp"), await page(1100));
  const later = new Date(Date.now() + 5_000);
  await utimes(path.join(folder, "floor-1.webp"), later, later);
  const rebuilt = await readThumbnail();
  expect(rebuilt.meta.width).toBe(640);
  expect(rebuilt.meta.height).toBe(960);
});

test("only makes thumbnails of drawing pages", async () => {
  await expect(
    openJobRoomThumbnail(`${job}/${upload}/plan.pdf`),
  ).rejects.toThrow("Not a drawing page");
});
