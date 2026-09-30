import { ESLint } from "eslint";
import { readFile } from "node:fs/promises";
import path from "node:path";
const baseline = JSON.parse(
  await readFile(new URL("../eslint-baseline.json", import.meta.url), "utf8"),
);
const key = (file, rule, message) =>
  JSON.stringify([file, rule, message.split("\n")[0]]);
const allowed = new Map(
  baseline.map((entry) => [
    key(entry.file, entry.rule, entry.message),
    entry.count,
  ]),
);
const eslint = new ESLint();
const results = await eslint.lintFiles(["src"]);
let existing = 0;
let added = 0;
for (const result of results)
  for (const message of result.messages) {
    if (message.severity !== 2) continue;
    const file = path.relative(process.cwd(), result.filePath);
    const id = key(file, message.ruleId, message.message);
    const count = allowed.get(id) ?? 0;
    if (count) {
      allowed.set(id, count - 1);
      existing++;
    } else {
      added++;
      console.error(
        `${file}:${message.line}:${message.column} ${message.ruleId ?? "parser"}: ${message.message}`,
      );
    }
  }
console.log(
  `Lint: ${added} new errors; ${existing} existing baseline errors. Rules remain enabled; pnpm lint:strict shows all debt.`,
);
if (added) process.exitCode = 1;
