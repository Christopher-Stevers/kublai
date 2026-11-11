import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { assertDisposableWorkspace, assertInputSymlinks } from './canonical-guards.mjs';
test('cleanup rejects source/output/active descendants including symlinked parents', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'release-guard-'));
  try {
    const canonical = path.join(root, 'canonical'); await mkdir(canonical);
    await symlink(canonical, path.join(root, 'alias'));
    for (const target of [canonical, path.join(canonical, 'source'), path.join(root, 'alias', 'new-output')]) {
      await assert.rejects(assertDisposableWorkspace(canonical, { protectedPath: target }), /refusing cleanup/);
    }
    await mkdir(path.join(root, 'source'));
    await symlink(path.join(canonical, 'future-file'), path.join(root, 'source', 'nested-link'));
    await assert.rejects(assertInputSymlinks(canonical, [path.join(root, 'source')]), /refusing cleanup/);
    await assertDisposableWorkspace(canonical, { source: path.join(root, 'source'), destination: path.join(root, 'canonical-other', 'output') });
  } finally { await rm(root, { recursive: true }); }
});
