import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep imported catalogue assets available in clean checkouts and release images.
const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(
  await readFile(path.join(root, "data/catalogue/aws-image-assets-20261108.json"), "utf8"),
);
const failures = [];
for (const entry of manifest.files) {
  if (!/^public\/images\/catalog\/uploads\/part-[0-9a-f-]+\.webp$/i.test(entry.path)) {
    failures.push(`Invalid asset path: ${entry.path}`);
    continue;
  }
  try {
    const bytes = await readFile(path.join(root, entry.path));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
      failures.push(`Checksum mismatch: ${entry.path}`);
    }
  } catch {
    failures.push(`Missing asset: ${entry.path}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Verified ${manifest.files.length} bundled catalogue images.`);
}
