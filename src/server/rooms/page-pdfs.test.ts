// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type * as PagePdfs from "./page-pdfs";

const job = "0391aed4-7773-47ec-9141-09df373ec008";
const upload = "b06815cb-ebac-42e0-8521-db654e9cad60";
const hasQpdf = (() => {
  try {
    execFileSync("qpdf", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let root: string;
let dir: string;
let pages: typeof PagePdfs;

/** Sheets with a hidden layer and a link to the next sheet. */
async function drawingSet(count: number) {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const hidden = context.register(
    context.obj({ Type: "OCG", Name: PDFString.of("Hidden") }),
  );
  doc.catalog.set(
    PDFName.of("OCProperties"),
    context.obj({ OCGs: [hidden], D: { OFF: [hidden] } }),
  );
  const made = Array.from({ length: count }, () => doc.addPage([600, 400]));
  made.forEach((page, index) => {
    page.drawText(`Sheet ${index + 1} ${"x".repeat(400 * (index + 1))}`, {
      x: 20,
      y: 300,
      size: 4,
    });
    page.node.set(
      PDFName.of("Annots"),
      context.obj([
        context.register(
          context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [50, 50, 150, 150],
            Dest: [made[(index + 1) % count]!.ref, PDFName.of("Fit")],
          }),
        ),
      ]),
    );
  });
  return doc.save({ useObjectStreams: false });
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "page-pdfs-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);
  dir = path.join(root, "uploads", "job-floor-plans", job, upload);
  pages = await import("./page-pdfs");
});
afterAll(() => rm(root, { recursive: true, force: true }));
beforeEach(async () => {
  pages.resetPagePdfsForTest();
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
});

test("accepts only page files inside an upload folder", () => {
  const ok = (key: string) => pages.PAGE_PDF_KEY.test(key);
  expect(ok(`${job}/${upload}/pages/index.json`)).toBe(true);
  expect(ok(`${job}/${upload}/pages/12.pdf`)).toBe(true);
  expect(ok(`${job}/${upload}/pages/0.pdf`)).toBe(false);
  expect(ok(`${job}/${upload}/pages/../plan.pdf`)).toBe(false);
  expect(ok(`${job}/pages/1.pdf`)).toBe(false);
  expect(ok(`${job}/${upload}/pages/1.pdf/x`)).toBe(false);
  expect(ok(`${job}/${upload}/pages/index.json.tmp`)).toBe(false);
});

test.skipIf(!hasQpdf)(
  "splits a set into one PDF per sheet, keeping layers, and lists the sizes",
  async () => {
    await writeFile(path.join(dir, "plan.pdf"), await drawingSet(3));
    await writeFile(path.join(dir, "floor-2.webp"), Buffer.alloc(1234));
    await pages.preparePagePdf(`${job}/${upload}/pages/index.json`);

    const index = JSON.parse(
      await readFile(path.join(dir, "pages", "index.json"), "utf8"),
    ) as PagePdfs.PagePdfIndex;
    expect(index.v).toBe(1);
    expect(index.pages.map((page) => page.image)).toEqual([null, 1234, null]);
    for (const [at, entry] of index.pages.entries()) {
      const bytes = await readFile(path.join(dir, "pages", `${at + 1}.pdf`));
      expect(entry.pdf).toBe(bytes.length);
      const page = await PDFDocument.load(bytes);
      expect(page.getPageCount()).toBe(1);
      // Layers switched off in the set stay switched off in the page.
      expect(page.catalog.has(PDFName.of("OCProperties"))).toBe(true);
      expect(page.getPage(0).node.Annots()?.size()).toBe(1);
    }
    // Each page carries its own sheet only.
    expect(index.pages[0]!.pdf!).toBeLessThan(index.pages[2]!.pdf!);
    expect((await readdir(dir)).sort()).toEqual([
      "floor-2.webp",
      "pages",
      "plan.pdf",
    ]);
  },
);

test.skipIf(!hasQpdf)("a one-page file gets no page copy", async () => {
  await writeFile(path.join(dir, "plan.pdf"), await drawingSet(1));
  await pages.ensurePagePdfs(`${job}/${upload}`);
  expect((await readdir(path.join(dir, "pages"))).sort()).toEqual([
    "index.json",
  ]);
  const index = JSON.parse(
    await readFile(path.join(dir, "pages", "index.json"), "utf8"),
  ) as PagePdfs.PagePdfIndex;
  expect(index.pages).toEqual([{ pdf: null, image: null }]);
});

test.skipIf(!hasQpdf)(
  "a file that cannot be split leaves nothing behind and is not retried at once",
  async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await writeFile(path.join(dir, "plan.pdf"), "not a pdf");
    await pages.ensurePagePdfs(`${job}/${upload}`);
    expect(await readdir(dir)).toEqual(["plan.pdf"]);
    expect(error).toHaveBeenCalledTimes(1);
    await pages.ensurePagePdfs(`${job}/${upload}`);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  },
);

test("ignores keys that are not page files and uploads with no PDF", async () => {
  await pages.preparePagePdf(`${job}/${upload}/plan.pdf`);
  await pages.preparePagePdf(`${job}/${upload}/pages/1.pdf`);
  expect(await readdir(dir)).toEqual([]);
  await expect(pages.ensurePagePdfs("../etc")).rejects.toThrow(
    "Invalid upload",
  );
});
