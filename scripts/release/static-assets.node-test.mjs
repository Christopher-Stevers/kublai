import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { brotliDecompressSync } from 'node:zlib';
import { retainStatic, compressStatic } from './static-assets.mjs';
import { staticHandler } from './static-handler.mjs';

test('old chunks survive, collisions fail and Brotli is delivered with correct headers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'release-assets-'));
  const old = path.join(root, 'old'), current = path.join(root, 'current');
  await mkdir(old); await mkdir(current);
  const data = 'console.log("unchanged cached chunk");'.repeat(100);
  await writeFile(path.join(old, 'abc.js'), data);
  await writeFile(path.join(current, 'def.js'), 'new chunk');
  assert.equal(await retainStatic(old, current), 1);
  assert.equal(await readFile(path.join(current, 'abc.js'), 'utf8'), data);
  await compressStatic(current);
  const handler = staticHandler(current);
  const server = createServer(async (req, res) => { if (!(await handler(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/_next/static/abc.js`;
    const response = await fetch(url, { headers: { 'Accept-Encoding': 'br' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-encoding'), 'br');
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.equal(response.headers.get('vary'), 'Accept-Encoding');
    assert.equal(await response.text(), data);
    const raw = await fetch(url, { headers: { 'Accept-Encoding': 'br;q=0, gzip;q=0' } });
    assert.equal(raw.headers.get('content-encoding'), null);
    assert.equal(await raw.text(), data);
    assert.equal(brotliDecompressSync(await readFile(path.join(current, 'abc.js.br'))).toString(), data);
    await writeFile(path.join(current, 'abc.js'), 'collision');
    await assert.rejects(retainStatic(old, current), /collision/);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true }); }
});
