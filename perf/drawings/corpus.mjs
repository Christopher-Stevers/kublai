import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const dir = path.resolve("perf/drawings/private");
const sources = JSON.parse(
  await readFile(path.join(dir, "sources.json"), "utf8"),
);
const unique = new Map();
for (const source of sources.files) {
  const bytes = await readFile(source.file);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (!unique.has(hash)) {
    const count = Number(
      execFileSync("qpdf", ["--show-npages", source.file], {
        encoding: "utf8",
      }).trim(),
    );
    unique.set(hash, { ...source, count });
  }
}
await mkdir(path.join(dir, "pages"), { recursive: true, mode: 0o700 });
const samples = [],
  hashes = new Set(),
  slots = new Set();
try {
  const previous = JSON.parse(
    await readFile(path.join(dir, "corpus.json"), "utf8"),
  );
  for (const sample of previous.samples) {
    const slot = `${sample.sourceHash}:${sample.page}`;
    if (slots.has(slot)) continue;
    slots.add(slot);
    samples.push(sample);
    hashes.add(sample.hash);
  }
} catch {}
for (let round = 0; round < 100 && samples.length < 100; round++)
  for (const source of unique.values()) {
    if (samples.length >= 100) break;
    const number =
      round === 0
        ? 1
        : round === 1
          ? Math.ceil(source.count / 2)
          : round === 2
            ? source.count
            : round - 1;
    if (
      number > source.count ||
      number < 1 ||
      slots.has(`${source.uploadHash}:${number}`)
    )
      continue;
    slots.add(`${source.uploadHash}:${number}`);
    const target = path.join(
      dir,
      "pages",
      `${source.uploadHash}-${number}.pdf`,
    );
    try {
      execFileSync(
        "qpdf",
        [source.file, "--pages", ".", String(number), "--", target],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch (error) {
      if (error.status !== 3) continue;
    }
    const bytes = await readFile(target),
      hash = createHash("sha256").update(bytes).digest("hex");
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    samples.push({
      file: target,
      hash,
      sourceHash: source.uploadHash,
      page: number,
      pdfBytes: bytes.length,
    });
  }
await writeFile(
  path.join(dir, "corpus.json"),
  JSON.stringify(
    { provenance: sources.provenance, uniqueSets: unique.size, samples },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({ uniqueSets: unique.size, sheets: samples.length }),
);
