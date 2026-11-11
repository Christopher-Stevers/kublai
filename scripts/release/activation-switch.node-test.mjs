import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, realpath, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { switchRelease } from './activation-switch.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'foremanhq-release-switch-'));
  try {
    const previous = path.join(root, 'previous'), candidate = path.join(root, 'candidate'), activeLink = path.join(root, '.next');
    await mkdir(previous); await mkdir(candidate); await symlink(previous, activeLink);
    await run({ root, previous, candidate, activeLink });
    assert.equal((await readdir(root)).filter(name => name.startsWith('.next-switch-')).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('selects the exact candidate before restarting and checking its output', async () => fixture(async data => {
  const calls = [];
  await switchRelease({ ...data,
    restart: async () => { calls.push('restart'); assert.equal(await realpath(data.activeLink), data.candidate); },
    checkCandidate: () => { calls.push('check'); },
    checkRollback: () => { throw Error('Unexpected rollback'); },
  });
  assert.deepEqual(calls, ['restart', 'check']);
}));
test('restores the old symlink and service after a failed candidate check', async () => fixture(async data => {
  const selected = [];
  await assert.rejects(switchRelease({ ...data,
    restart: async () => { selected.push(await realpath(data.activeLink)); },
    checkCandidate: () => { throw Error('wrong service-worker bytes'); },
    checkRollback: async () => assert.equal(await realpath(data.activeLink), data.previous),
  }), /previous release restored/);
  assert.deepEqual(selected, [data.candidate, data.previous]);
  assert.equal(await realpath(data.activeLink), data.previous);
}));
test('reports rollback failure separately and leaves the symlink pointing to the old build', async () => fixture(async data => {
  let attempts = 0;
  await assert.rejects(switchRelease({ ...data,
    restart: () => { attempts++; throw Error(attempts === 1 ? 'candidate restart failed' : 'old restart failed'); },
    checkCandidate: () => {}, checkRollback: () => {},
  }), error => error instanceof AggregateError && /rollback needs attention/.test(error.message));
  assert.equal(await realpath(data.activeLink), data.previous);
}));
test('refuses a stale preflight without restarting anything', async () => fixture(async data => {
  let restarts = 0;
  await assert.rejects(switchRelease({ ...data, previous: data.candidate,
    restart: () => { restarts++; }, checkCandidate: () => {}, checkRollback: () => {},
  }), /changed during validation/);
  assert.equal(restarts, 0);
  assert.equal(await realpath(data.activeLink), data.previous);
}));
