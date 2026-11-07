import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { workerCommand } from "~/server/background/command";
import type { TitleBlockWord } from "~/lib/drawing-title-block";
import type { HyperlinkImage } from "./hyperlink-vision";

let active = 0;
export async function hyperlinkImages(
  file: string,
  page: number,
): Promise<{ images: HyperlinkImage[]; words: TitleBlockWord[] }> {
  if (active >= 2)
    throw Error("Two drawings are already being prepared. Try again shortly.");
  active++;
  let directory: string | undefined;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "foremanhq-hyperlink-"));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=512",
          ...workerCommand("src/server/drawings/hyperlink-render-worker.ts"),
          file,
          directory!,
          String(page),
        ],
        { stdio: "ignore" },
      );
      const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.once("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(Error("The drawing could not be prepared for the reader."));
      });
    });
    const manifestFile = path.join(directory, "page.json");
    if ((await stat(manifestFile)).size > 4 * 1024 * 1024)
      throw Error("Drawing text exceeds reading limit");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
      images: Array<Omit<HyperlinkImage, "png"> & { file: string }>;
      words: TitleBlockWord[];
    };
    if (manifest.images.length !== 5) throw Error("Incomplete drawing render");
    const images: HyperlinkImage[] = [];
    let bytes = 0;
    for (const [i, image] of manifest.images.entries()) {
      if (image.file !== `${i}.png`) throw Error("Invalid drawing render");
      const target = path.join(directory, image.file);
      bytes += (await stat(target)).size;
      if (bytes > 12 * 1024 * 1024)
        throw Error("Drawing images exceed reading limit");
      images.push({ ...image, png: await readFile(target) });
    }
    return { images, words: manifest.words };
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    active--;
  }
}
