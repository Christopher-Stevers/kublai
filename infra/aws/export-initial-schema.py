"""Fresh-install DDL, not an upgrade migration. Apply only to an empty DB.

Drizzle 0.31 emits FKs before their referenced unique indexes; reorder the indexes.
"""
import subprocess
import sys

result = subprocess.run([
    'node', 'node_modules/drizzle-kit/bin.cjs', 'export',
    '--dialect=postgresql', '--schema=src/server/db/schema.ts',
], text=True, capture_output=True, check=True)
sql = result.stdout
if not sql.startswith('CREATE TABLE') or 'CREATE TABLE "kublai_organization"' not in sql:
    raise SystemExit('Schema export failed: ' + result.stderr)
lines = sql.splitlines(keepends=True)
indexes = [line for line in lines if line.startswith(('CREATE INDEX ', 'CREATE UNIQUE INDEX '))]
if not indexes or any(not line.rstrip().endswith(';') for line in indexes):
    raise SystemExit('Unexpected index DDL format; review exporter before proceeding')
remaining = ''.join(line for line in lines if line not in indexes)
pos = remaining.index('ALTER TABLE ')
sys.stdout.write(remaining[:pos] + ''.join(indexes) + remaining[pos:])
