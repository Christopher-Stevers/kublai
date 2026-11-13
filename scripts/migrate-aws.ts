import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("DATABASE_MIGRATION_URL is required (schema-owner credentials)");
const runtimeRole = process.env.DATABASE_RUNTIME_ROLE ?? "foreman_app";
if (!["foreman_app", "foreman_dev_app"].includes(runtimeRole)) throw new Error("Invalid runtime role");
const target = new URL(url);
const tunnelPort = process.env.MIGRATION_TUNNEL_PORT;
const client = postgres(url, {
  max: 1,
  ...(tunnelPort ? { host: "127.0.0.1", port: Number(tunnelPort) } : {}),
  ssl: process.env.CI === "true" && target.hostname === "127.0.0.1"
    ? false
    : { rejectUnauthorized: true, ca: readFileSync("infra/aws/rds-ca.pem", "utf8"), servername: target.hostname },
  connect_timeout: 15,
  onnotice: () => undefined,
});
try {
  // One pinned connection keeps the advisory lock for the complete migration run.
  await client`select pg_advisory_lock(726581940)`;
  await migrate(drizzle(client), { migrationsFolder: "drizzle-aws", migrationsSchema: "drizzle_aws" });
  await client`grant usage on schema public to ${client(runtimeRole)}`;
  await client`grant select, insert, update, delete on all tables in schema public to ${client(runtimeRole)}`;
  await client`grant usage, select on all sequences in schema public to ${client(runtimeRole)}`;
  await client`alter default privileges in schema public grant select, insert, update, delete on tables to ${client(runtimeRole)}`;
  await client`alter default privileges in schema public grant usage, select on sequences to ${client(runtimeRole)}`;
  console.log("AWS Drizzle migrations applied successfully.");
} finally {
  await client.end();
}
