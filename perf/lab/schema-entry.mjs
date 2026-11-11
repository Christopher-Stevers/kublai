import fs from "node:fs/promises";
import path from "node:path";
import { tsImport } from "tsx/esm/api";
import { is, getTableName } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
const root = process.env.PERF_SOURCE_ROOT ?? process.cwd();
const directory = process.env.PERF_LAB_SOCKET;
if (!directory?.startsWith("/tmp/foremanhq-perf-pg."))
  throw new Error("Disposable lab schema directory required");
async function schemas(dir) {
  const rows = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...(await schemas(file)));
    else if (entry.name.endsWith("schema.ts")) rows.push(file);
  }
  return rows;
}
const main = path.join(root, "src/server/db/schema.ts");
const modules = [
  main,
  ...(await schemas(path.join(root, "src/server")))
    .sort()
    .filter((file) => file !== main),
];
const seen = new Set(),
  lines = [],
  tables = [],
  enums = [];
for (const file of modules) {
  const module = await tsImport(file, import.meta.url);
  const keys = [];
  for (const [key, value] of Object.entries(module)) {
    let identity;
    if (is(value, PgTable)) {
      const config = getTableConfig(value);
      identity = `table:${config.schema ?? "public"}:${getTableName(value)}`;
    } else if (
      typeof value === "function" &&
      typeof value.enumName === "string" &&
      Array.isArray(value.enumValues)
    )
      identity = `enum:${value.schema ?? "public"}:${value.enumName}`;
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    keys.push(key);
    (identity.startsWith("table:") ? tables : enums).push(identity);
  }
  if (keys.length)
    lines.push(`export { ${keys.join(", ")} } from ${JSON.stringify(file)};`);
}
const entry = path.join(directory, "schema-entry.ts");
await fs.writeFile(entry, lines.join("\n") + "\n");
await fs.writeFile(
  path.join(directory, "schema-inventory.json"),
  JSON.stringify(
    {
      source:
        "main plus standalone service schema modules from selected release; table/enum identity deduplicated",
      moduleCount: modules.length,
      tables: tables.sort(),
      enums: enums.sort(),
      limitations:
        "Source-declared tables only; migration-only functions/settings require endpoint preflight. Not a claim that unexercised features are complete.",
    },
    null,
    2,
  ),
);
console.log(
  `Prepared ${tables.length} unique declared tables and ${enums.length} enums from ${modules.length} schema modules.`,
);
