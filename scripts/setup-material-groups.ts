/** Run with node --import dotenv/config --import tsx scripts/setup-material-groups.ts [--apply]. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { initialPvcGroup } from "../src/lib/material-groups";
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
try {
  const email = process.env.DEV_AUTH_EMAIL?.trim();
  if (!email)
    throw new Error(
      "Configure DEV_AUTH_EMAIL to select the organization for this one-time setup.",
    );
  const [user] =
    await sql`select "organizationId" from kublai_user where lower(email)=lower(${email}) limit 1`;
  if (!user?.organizationId)
    throw new Error("The selected account has no organization.");
  const org = String(user.organizationId);
  const before =
    await sql`select id,name,coalesce(to_jsonb(m)->'groupPath','[]'::jsonb) as "groupPath" from kublai_material m where "organizationId"=${org} order by name`;
  const changes = before.flatMap((row) => {
    const groupPath = initialPvcGroup(row.name as string);
    return groupPath && Array.isArray(row.groupPath) && !row.groupPath.length
      ? [{ id: row.id as string, name: row.name, groupPath }]
      : [];
  });
  console.log(
    JSON.stringify({
      mode: process.argv.includes("--apply") ? "apply" : "preview",
      changes: changes.map(({ name, groupPath }) => ({ name, groupPath })),
    }),
  );
  if (process.argv.includes("--apply")) {
    await mkdir("state-backups", { recursive: true });
    const filename = path.join(
      "state-backups",
      `material-groups-before-${Date.now()}.json`,
    );
    await writeFile(
      filename,
      JSON.stringify({ organizationId: org, materials: before }, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    const migration = await readFile(
      "drizzle/0035_material_groups.sql",
      "utf8",
    );
    await sql.begin(async (tx) => {
      await tx.unsafe(migration);
      for (const change of changes) {
        await tx.unsafe(
          'update kublai_material set "groupPath"=$1::jsonb where id=$2 and "organizationId"=$3 and "groupPath"=jsonb_build_array()',
          [JSON.stringify(change.groupPath), change.id, org],
        );
      }
    });
    console.log(`Saved material groups. Backup: ${filename}`);
  }
} finally {
  await sql.end();
}
