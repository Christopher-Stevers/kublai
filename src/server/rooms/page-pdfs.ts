import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * One small PDF per sheet, beside an upload's `plan.pdf`. A drawing set is one
 * large file, and reading one sheet out of it over a weak signal takes many
 * round trips and more bytes than the sheet holds. The first time a set is
 * opened its pages are split out with qpdf and kept on disk:
 *
 *   <job>/<upload>/pages/<n>.pdf     page n alone, layers and links kept
 *   <job>/<upload>/pages/index.json  byte sizes, written last
 *
 * A host without qpdf, or a PDF it cannot split, simply has no `pages` folder
 * and sheets are read from `plan.pdf` as before.
 */
const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "job-floor-plans");
const UPLOAD = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;
export const PAGE_PDF_KEY =
  /^([0-9a-f-]{36}\/[0-9a-f-]{36})\/pages\/(?:index\.json|[1-9]\d{0,4}\.pdf)$/i;
const MAX_PAGES = 2000;
/** How long a first request waits for the split before answering "not yet". */
const WAIT_MS = 1500;
const RETRY_MS = 10 * 60_000;

export type PagePdfIndex = {
  v: 1;
  /** Entry n-1 is page n: its own PDF and its sheet image, in bytes. */
  pages: { pdf: number | null; image: number | null }[];
};

const jobs = new Map<string, Promise<void>>();
const failed = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();
let unavailable = false;

function qpdf(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "qpdf",
      args,
      { timeout: 120_000, maxBuffer: 256 * 1024, windowsHide: true },
      (error, stdout) => {
        // Exit 3 is "written, with warnings", which damaged CAD exports cause.
        if (!error || (error as { code?: unknown }).code === 3) resolve(stdout);
        else reject(error instanceof Error ? error : new Error("qpdf failed"));
      },
    );
  });
}

const size = (file: string) =>
  stat(file).then(
    (info) => info.size,
    () => null,
  );

async function split(upload: string) {
  const dir = path.join(UPLOAD_ROOT, upload);
  const source = path.join(dir, "plan.pdf");
  const target = path.join(dir, "pages");
  const total = await size(source);
  if (total === null || (await size(path.join(target, "index.json"))) !== null)
    return;
  const count = Number((await qpdf(["--show-npages", source])).trim());
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PAGES)
    throw new Error("Unexpected page count");
  const temporary = path.join(dir, `pages.${randomUUID()}.tmp`);
  try {
    await mkdir(temporary);
    const index: PagePdfIndex = { v: 1, pages: [] };
    for (let page = 1; page <= count; page++) {
      let bytes: number | null = null;
      // A one-page file is its own page.
      if (count > 1) {
        const file = path.join(temporary, `${page}.pdf`);
        // Keeping the original as the base file keeps its layer settings;
        // links to other pages lose their targets, which the viewer reads
        // from the original when one is tapped.
        await qpdf([source, "--pages", ".", String(page), "--", file]);
        bytes = await size(file);
        // Some exports share every resource between pages. A "page" that is
        // most of the set saves nothing.
        if (bytes !== null && count >= 4 && bytes > total / 2) {
          await rm(file, { force: true });
          bytes = null;
        }
      }
      index.pages.push({
        pdf: bytes,
        image: await size(path.join(dir, `floor-${page}.webp`)),
      });
    }
    await writeFile(path.join(temporary, "index.json"), JSON.stringify(index));
    // Another server process may have finished first; its folder is as good.
    await rename(temporary, target).catch(() => undefined);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Splits an upload's pages once. Resolves when its `pages` folder is settled. */
export function ensurePagePdfs(upload: string) {
  if (!UPLOAD.test(upload)) return Promise.reject(new Error("Invalid upload"));
  if (unavailable || (failed.get(upload) ?? 0) > Date.now())
    return Promise.resolve();
  let job = jobs.get(upload);
  if (!job) {
    // One set at a time: this shares a machine with page requests.
    const run = queue.then(() => split(upload));
    queue = run.catch(() => undefined);
    job = run
      .catch((error: unknown) => {
        if ((error as { code?: unknown }).code === "ENOENT") unavailable = true;
        failed.set(upload, Date.now() + RETRY_MS);
        console.error(
          "Drawing page split failed",
          error instanceof Error ? error.message.slice(0, 200) : "Unknown",
        );
      })
      .finally(() => jobs.delete(upload));
    jobs.set(upload, job);
  }
  return job;
}

/** For a `pages/…` key: gives a first request a moment to find its file. */
export async function preparePagePdf(storageKey: string) {
  const upload = PAGE_PDF_KEY.exec(storageKey)?.[1];
  if (!upload) return;
  if ((await size(path.join(UPLOAD_ROOT, storageKey))) !== null) return;
  await Promise.race([
    ensurePagePdfs(upload),
    new Promise((resolve) => setTimeout(resolve, WAIT_MS)),
  ]);
}

export function resetPagePdfsForTest() {
  jobs.clear();
  failed.clear();
  queue = Promise.resolve();
  unavailable = false;
}
