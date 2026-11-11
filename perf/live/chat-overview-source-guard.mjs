import fs from "node:fs";
import crypto from "node:crypto";
const [manifest, expected, out] = process.argv.slice(2);
const bytes = fs.readFileSync(manifest),
  digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
if (digest(bytes) !== expected) throw Error("Unexpected proof manifest");
const source = JSON.parse(bytes);
for (const row of source.files)
  if (digest(fs.readFileSync(row.path)) !== row.sha256)
    throw Error("Source input changed: " + row.path);
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      manifestSHA256: expected,
      filesChecked: source.files.length,
      status: "pass",
    },
    null,
    2,
  ),
);
