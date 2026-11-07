/** Publish only the fifth reader's immutable predictions. Never connects to a database.
 * tsx scripts/publish-packing-slip-liquid.ts <original trial directory> <liquid output> [--apply]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  trialIndexSchema,
  trialResultSchema,
} from "../src/lib/packing-slip-trial";

const [baseArg, liquidArg, flag] = process.argv.slice(2);
if (!baseArg || !liquidArg || (flag && flag !== "--apply"))
  throw Error(
    "Supply original trial and Liquid output folders, optionally --apply.",
  );
const base = path.resolve(baseArg),
  liquid = path.resolve(liquidArg);
const read = async (file: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(file, "utf8")) as unknown;
const publication = (await read(path.join(base, "publication.json"))) as {
  dest: string;
  runId: string;
};
const dest = path.resolve(publication.dest);
if (
  !dest.includes(`${path.sep}.packing-trials${path.sep}`) ||
  path.basename(dest) !== publication.runId
)
  throw Error("Unexpected private trial destination.");
const indexFile = path.join(dest, "index.json");
const originalIndex = await fs.readFile(indexFile);
const index = trialIndexSchema.parse(
  JSON.parse(originalIndex.toString("utf8")),
);
if (
  index.runId !== publication.runId ||
  path.basename(path.dirname(dest)) !== index.jobId ||
  path.basename(path.dirname(path.dirname(dest))) !== index.organizationId
)
  throw Error("Trial scope mismatch.");
const inputs = (await read(path.join(base, "inputs/manifest.json"))) as Array<{
  caseId: string;
  documentId: string;
  versionId: string;
  sha256: string;
  pages: string[];
}>;
const orders = (await read(path.join(base, "inputs/orders.json"))) as Array<{
  id: string;
  orderNumber: string;
  supplier: string;
  items: Array<{ id: string; description: string }>;
}>;
const itemOrders = new Map(
  orders.flatMap((o) => o.items.map((i) => [i.id, o.id] as const)),
);
const itemNames = new Map(
  orders.flatMap((o) => o.items.map((i) => [i.id, i.description] as const)),
);
const hash = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
const manifestHash = hash(
  await fs.readFile(path.join(base, "inputs/manifest.json")),
);
const ordersHash = hash(
  await fs.readFile(path.join(base, "inputs/orders.json")),
);
async function atomic(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + ".liquid-tmp";
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
const prepared: Array<{
  file: string;
  result: unknown;
  raw: string;
  hash: string;
}> = [];
let pending = 0,
  complete = 0,
  failed = 0;
for (const entry of index.cases) {
  const input = inputs.find((c) => c.caseId === entry.caseId);
  if (
    input?.documentId !== entry.documentId ||
    input.versionId !== entry.versionId ||
    input.sha256 !== entry.sha256 ||
    input.pages.length !== entry.pages
  )
    throw Error("Frozen source mismatch: " + entry.caseId);
  let raw: string;
  try {
    raw = await fs.readFile(
      path.join(liquid, "results", entry.caseId + ".json"),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    entry.readers = { ...entry.readers, liquid: "pending" };
    pending++;
    continue;
  }
  const result = trialResultSchema.parse(JSON.parse(raw));
  if (
    result.reader !== "liquid" ||
    result.caseId !== entry.caseId ||
    result.sourceSha256 !== entry.sha256 ||
    result.model !== "LiquidAI/LFM3-VL-2B"
  )
    throw Error("Liquid identity mismatch: " + entry.caseId);
  if (result.modelRevision !== "f83d2b0a2296aaa277f394990a9b8b949ddf9691")
    throw Error("Unpinned model revision");
  if (
    result.inputManifestSha256 !== manifestHash ||
    result.inputOrdersSha256 !== ordersHash
  )
    throw Error("Liquid inputs do not match the frozen trial.");
  const pageEvidence = result.pageEvidence as Array<{
    page: number;
    sha256: string;
  }>;
  if (
    !Array.isArray(pageEvidence) ||
    pageEvidence.length !== input.pages.length
  )
    throw Error("Missing page provenance");
  for (let p = 0; p < input.pages.length; p++)
    if (
      pageEvidence[p]?.page !== p + 1 ||
      pageEvidence[p]?.sha256 !== hash(await fs.readFile(input.pages[p]!))
    )
      throw Error("Page pixels changed");
  const pages = new Set(result.pagesRead);
  if (
    result.pagesRead?.some((p) => p > entry.pages) ||
    (result.status === "complete" &&
      input.pages.some((_, i) => !pages.has(i + 1)))
  )
    throw Error("Page coverage mismatch");
  const order = orders.find((o) => o.id === result.orderId);
  if (result.orderId && !order) throw Error("Order outside frozen job");
  const ids = new Set<string>();
  for (const line of result.lines) {
    if (ids.has(line.lineId) || line.page > entry.pages)
      throw Error("Invalid line provenance");
    ids.add(line.lineId);
    if (
      line.orderItemId &&
      (!order || itemOrders.get(line.orderItemId) !== order.id)
    )
      throw Error("Item outside selected job order");
  }
  const sha = hash(raw);
  const output = {
    ...result,
    artifactSha256: sha,
    orderLabel: order ? `${order.orderNumber} · ${order.supplier}` : undefined,
    lines: result.lines.map((l) => ({
      ...l,
      matchedDescription: l.orderItemId
        ? itemNames.get(l.orderItemId)
        : undefined,
    })),
  };
  prepared.push({ file: entry.caseId, raw, hash: sha, result: output });
  entry.readers = { ...entry.readers, liquid: result.status };
  if (result.status === "complete") complete++;
  else failed++;
}
if (flag) {
  const archive = path.join(
    dest,
    "history/index-before-liquid",
    hash(originalIndex) + ".json",
  );
  await fs.mkdir(path.dirname(archive), { recursive: true, mode: 0o700 });
  await fs
    .writeFile(archive, originalIndex, { mode: 0o600, flag: "wx" })
    .catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    });
  for (const p of prepared) {
    const history = path.join(dest, "history/liquid", p.file, p.hash + ".json");
    await fs.mkdir(path.dirname(history), { recursive: true, mode: 0o700 });
    await fs
      .writeFile(history, p.raw, { mode: 0o600, flag: "wx" })
      .catch((e) => {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      });
    await atomic(path.join(dest, "results/liquid", p.file + ".json"), p.result);
  }
  index.updatedAt = new Date().toISOString();
  await atomic(indexFile, index);
}
const summary = {
  applied: !!flag,
  at: new Date().toISOString(),
  runId: index.runId,
  complete,
  failed,
  pending,
  total: index.cases.length,
  receiptWrites: 0,
};
await atomic(path.join(liquid, "publication.json"), summary);
console.log(JSON.stringify(summary));
