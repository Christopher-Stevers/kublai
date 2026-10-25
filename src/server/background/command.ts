import path from "node:path";
/** Production children use the immutable release; development keeps the source runner. */
export function workerCommand(entry: string): string[] {
  if (!/^src\/server\/[a-z0-9/.-]+\.ts$/.test(entry) || entry.includes(".."))
    throw Error("Invalid worker entry");
  const root = process.env.FOREMANHQ_WORKER_BUNDLE;
  return root
    ? [path.join(root, entry.replace(/^src\//, "").replace(/\.ts$/, ".mjs"))]
    : ["--import", "tsx", path.join(process.cwd(), entry)];
}
