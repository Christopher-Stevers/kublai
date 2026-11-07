#!/usr/bin/env node
// Content-addressed, versioned DB + upload snapshots. Credentials never enter logs.
import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
const [mode, argument, destination] = process.argv.slice(2);
const root = path.resolve(
  process.env.FOREMANHQ_REPO ?? path.join(import.meta.dirname, "../.."),
);
const backup =
  process.env.FOREMANHQ_BACKUP_DIR ??
  path.join(process.env.HOME, ".local/share/foremenhq-db-backups");
const secret = path.join(
  process.env.HOME,
  ".config/foremenhq/ubicloud-database-url",
);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const chunkSize = 4 * 1024 * 1024;
let sql;
async function remote() {
  if (!sql)
    sql = postgres((await readFile(secret, "utf8")).trim(), {
      max: 1,
      connect_timeout: 15,
      idle_timeout: 20,
    });
  return sql;
}
async function initRemote() {
  const db = await remote();
  await db`CREATE SCHEMA IF NOT EXISTS foremanhq_backups`;
  await db`CREATE TABLE IF NOT EXISTS foremanhq_backups.chunks(hash text PRIMARY KEY, data bytea NOT NULL)`;
  await db`CREATE TABLE IF NOT EXISTS foremanhq_backups.snapshots(id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), manifest jsonb NOT NULL)`;
}
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch((e) => {
    if (e.code === "ENOENT") return [];
    throw e;
  })) {
    if (entry.name === ".upload-sessions" || entry.name.endsWith(".tmp"))
      continue;
    const filename = path.join(dir, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Snapshot input contains a symbolic link");
    if (entry.isDirectory()) result.push(...(await files(filename)));
    else if (entry.isFile()) result.push(filename);
  }
  return result;
}
async function snapshot(dump) {
  const id = path.basename(dump, ".dump").replace(/^nightly-/, "");
  if (!/^\d{8}-\d{6}$/.test(id))
    throw new Error("Expected a timestamped nightly dump");
  const objectDir = path.join(backup, "objects");
  await mkdir(objectDir, { recursive: true, mode: 0o700 });
  await initRemote();
  const db = await remote();
  const manifest = { version: 1, id, files: [], chunks: [] };
  const known = new Set(
    (await db`SELECT hash FROM foremanhq_backups.chunks`).map(
      (row) => row.hash,
    ),
  );
  let uploaded = 0;
  const inputs = [
    path.resolve(dump),
    ...(await files(path.join(root, "uploads"))),
    ...(await files(path.join(root, "public/images"))),
  ];
  for (const filename of inputs) {
    const handle = await open(filename, "r");
    const chunks = [];
    let size = 0;
    const digest = createHash("sha256");
    try {
      for (;;) {
        const buffer = Buffer.alloc(chunkSize);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
        if (!bytesRead) break;
        const data = buffer.subarray(0, bytesRead);
        const key = hash(data);
        digest.update(data);
        chunks.push(key);
        size += bytesRead;
        const local = path.join(objectDir, key);
        const temporary = `${local}.${process.pid}.tmp`;
        await writeFile(temporary, data, { mode: 0o600 });
        const saved = await open(temporary, "r");
        await saved.sync();
        await saved.close();
        await rename(temporary, local);
        if (!known.has(key)) {
          await db`INSERT INTO foremanhq_backups.chunks(hash, data) VALUES (${key}, ${data}) ON CONFLICT DO NOTHING`;
          known.add(key);
          uploaded += bytesRead;
        }
      }
    } finally {
      await handle.close();
    }
    manifest.files.push({
      path:
        filename === path.resolve(dump)
          ? "database.dump"
          : path.relative(root, filename),
      size,
      sha256: digest.digest("hex"),
      chunks,
    });
  }
  manifest.chunks = [...new Set(manifest.files.flatMap((file) => file.chunks))];
  await db`INSERT INTO foremanhq_backups.snapshots(id, manifest) VALUES (${id}, ${db.json(manifest)}) ON CONFLICT(id) DO UPDATE SET manifest = excluded.manifest`;
  const manifestDir = path.join(backup, "snapshots");
  await mkdir(manifestDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(manifestDir, `${id}.json.tmp`),
    JSON.stringify(manifest),
    { mode: 0o600 },
  );
  await rename(
    path.join(manifestDir, `${id}.json.tmp`),
    path.join(manifestDir, `${id}.json`),
  );
  // Retention only runs after a complete manifest exists at both destinations.
  await db.begin(async (tx) => {
    await tx`DELETE FROM foremanhq_backups.snapshots WHERE id NOT IN (SELECT id FROM foremanhq_backups.snapshots ORDER BY id DESC LIMIT 14)`;
    await tx`DELETE FROM foremanhq_backups.chunks WHERE hash NOT IN (SELECT jsonb_array_elements_text(manifest->'chunks') FROM foremanhq_backups.snapshots)`;
  });
  const manifests = (await readdir(manifestDir))
    .filter((name) => /^\d{8}-\d{6}\.json$/.test(name))
    .sort()
    .reverse();
  const retain = new Set();
  for (const name of manifests.slice(0, 14))
    for (const key of JSON.parse(
      await readFile(path.join(manifestDir, name), "utf8"),
    ).chunks)
      retain.add(key);
  for (const name of manifests.slice(14))
    await rm(path.join(manifestDir, name));
  for (const name of await readdir(objectDir))
    if (/^[a-f0-9]{64}$/.test(name) && !retain.has(name))
      await rm(path.join(objectDir, name));
  console.log(
    `Snapshot ${id}: ${manifest.files.length} files; ${uploaded} new off-site bytes; 14-version retention`,
  );
}
async function restore(id, target) {
  if (!target || !path.isAbsolute(target))
    throw new Error("Restore requires an absolute, empty destination");
  if (
    (
      await readdir(target).catch((e) => {
        if (e.code === "ENOENT") return [];
        throw e;
      })
    ).length
  )
    throw new Error("Restore destination must be empty");
  const db = await remote();
  const rows =
    id === "latest"
      ? await db`SELECT manifest FROM foremanhq_backups.snapshots ORDER BY id DESC LIMIT 1`
      : await db`SELECT manifest FROM foremanhq_backups.snapshots WHERE id = ${id}`;
  const manifest = rows[0]?.manifest;
  if (manifest?.version !== 1)
    throw new Error("Snapshot not found or unsupported");
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    if (
      file.path !== "database.dump" &&
      !/^(uploads|public\/images)\//.test(file.path)
    )
      throw new Error("Invalid snapshot path");
    const dest = path.resolve(target, file.path);
    if (!dest.startsWith(path.resolve(target) + path.sep))
      throw new Error("Unsafe snapshot path");
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    const handle = await open(dest, "wx", 0o600);
    const digest = createHash("sha256");
    let size = 0;
    try {
      for (const key of file.chunks) {
        if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid chunk hash");
        const [chunk] =
          await db`SELECT data FROM foremanhq_backups.chunks WHERE hash = ${key}`;
        if (!chunk || hash(chunk.data) !== key)
          throw new Error("Missing or damaged snapshot chunk");
        let offset = 0;
        while (offset < chunk.data.length) {
          const { bytesWritten } = await handle.write(
            chunk.data,
            offset,
            chunk.data.length - offset,
          );
          if (!bytesWritten) throw new Error("Restore write failed");
          offset += bytesWritten;
        }
        digest.update(chunk.data);
        size += chunk.data.length;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (size !== file.size || digest.digest("hex") !== file.sha256)
      throw new Error("Restored file verification failed");
  }
  console.log(
    `Restored and verified ${manifest.files.length} files from ${manifest.id}`,
  );
}
try {
  if (mode === "snapshot") await snapshot(argument);
  else if (mode === "restore") await restore(argument, destination);
  else
    throw new Error(
      "Usage: backup-snapshot.mjs snapshot DUMP | restore ID|latest EMPTY_DIRECTORY",
    );
} catch (error) {
  console.error("Snapshot operation failed:", error.message);
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
