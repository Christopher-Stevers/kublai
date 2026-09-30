import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
const migration = await readFile(new URL('../../drizzle/0039_reliability_revisions.sql', import.meta.url), 'utf8');
const journal = JSON.parse(await readFile(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
const entry = journal.entries.find(row => row.tag === '0039_reliability_revisions');
const hash = createHash('sha256').update(migration).digest('hex');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async tx => {
    await tx`SET LOCAL lock_timeout = '5s'`;
    await tx`SET LOCAL statement_timeout = '30s'`;
    await tx`SELECT pg_advisory_xact_lock(72491834)`;
    const applied = await tx`SELECT id FROM drizzle.__drizzle_migrations WHERE hash = ${hash}`;
    if (applied.length) return;
    await tx.unsafe(migration);
    await tx`INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES (${hash}, ${entry.when})`;
  });
  console.log('Reliability migration applied and recorded atomically');
} finally { await sql.end(); }
