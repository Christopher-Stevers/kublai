import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RenderedSheet = {
  name: string;
  width: number;
  height: number;
  imageUrl: string;
};

async function runRenderer(args: string[]) {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(moduleDir, "../../..");
  const script = path.join(moduleDir, "upload-render-page.ts");
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=512",
        "--expose-gc",
        "--import",
        "dotenv/config",
        "--import",
        "tsx",
        script,
        ...args,
      ],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const append = (prior: string, chunk: Buffer) => {
      const next = prior + chunk.toString("utf8");
      if (next.length > 64 * 1024) {
        child.kill("SIGKILL");
        reject(new Error("PDF renderer produced excessive output"));
      }
      return next;
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            stderr.trim() ||
              `PDF renderer stopped (${signal ?? `exit ${code ?? "unknown"}`})`,
          ),
        );
    });
  });
}

export async function renderUploadPdf(
  dest: string,
  jobId: string,
  uploadId: string,
) {
  const file = await open(path.join(dest, "plan.pdf"), "r");
  try {
    const header = Buffer.alloc(1024);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (!header.subarray(0, bytesRead).includes(Buffer.from("%PDF-")))
      throw new Error("File is not a PDF");
  } finally {
    await file.close();
  }

  const inspected = JSON.parse(await runRenderer(["inspect", dest])) as {
    pages?: unknown;
  };
  if (!Number.isSafeInteger(inspected.pages) || Number(inspected.pages) < 1)
    throw new Error("PDF renderer returned an invalid page count");

  const sheets: RenderedSheet[] = [];
  for (
    let pageNumber = 1;
    pageNumber <= Number(inspected.pages);
    pageNumber++
  ) {
    const sheet = JSON.parse(
      await runRenderer(["page", dest, jobId, uploadId, String(pageNumber)]),
    ) as Partial<RenderedSheet>;
    if (
      typeof sheet.name !== "string" ||
      typeof sheet.width !== "number" ||
      typeof sheet.height !== "number" ||
      typeof sheet.imageUrl !== "string"
    )
      throw new Error("PDF renderer returned invalid sheet metadata");
    sheets.push(sheet as RenderedSheet);
  }
  return sheets;
}
