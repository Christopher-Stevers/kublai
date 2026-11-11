import fs from "node:fs";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Usage: pg-error-report.mjs private-server.log sanitized-report.json",
  );
const groups = new Map();
for (const line of fs.readFileSync(input, "utf8").split("\n")) {
  const match = line.match(/ERROR:\s+(?:([A-Z0-9]{5}):\s+)?(.*)/);
  if (!match) continue;
  const message = match[2]
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":fixture",
    )
    .replaceAll("perf-lab-user", ":fixture-user")
    .slice(0, 240);
  const key = JSON.stringify({ code: match[1] ?? "unknown", message });
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      source:
        "private disposable PostgreSQL ERROR headers only; SQL statements, parameters and details excluded",
      errors: [...groups].map(([key, count]) => ({
        ...JSON.parse(key),
        count,
      })),
    },
    null,
    2,
  ),
);
