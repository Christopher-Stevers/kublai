import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { budgets } from '../../perf/check.mjs';
import { inspectReleaseAssets, validateActivationReports } from './activation-gate.mjs';
import { SOURCE_FINGERPRINT_ALGORITHM, LAB_TRANSFORM_PATHS } from './source-fingerprint.mjs';

const oldBuild = 'a'.repeat(64), newBuild = 'b'.repeat(64);
function report(build, timestamp, sourceBuild = oldBuild) {
  return {
    build, timestamp, sourceBuild, sourceFingerprint: sourceBuild,
    sourceBinding: { method: 'frozen-release-inputs-sha256', algorithm: SOURCE_FINGERPRINT_ALGORITHM, sourceBuild },
    sourceFileCount: 20,
    sourceVerification: { stage: 'after-lab-transforms', unchangedFilesChecked: 20 - LAB_TRANSFORM_PATHS.length, allowedLabTransforms: LAB_TRANSFORM_PATHS },
    version: 1, provenance: 'isolated-seeded-app', cpuSlowdown: 4,
    static: { build: sourceBuild, sharedGzipBytes: 400000, screenGzipBytes: 700000, deployGzipBytes: 90000, idlePolls: 8 },
    samples: budgets.journeys.flatMap(journey => Object.keys(budgets.links).flatMap(link =>
      Array.from({ length: 5 }, (_, run) => ({ journey, link, run, variant: 'visited', durationMs: 100 })))),
  };
}
const evidence = () => ({
  baseline: report('lab-baseline', '2026-01-01T00:00:00Z'),
  repeat: report('lab-baseline', '2026-01-01T01:00:00Z'),
  candidate: report('lab-candidate', '2026-01-01T02:00:00Z', newBuild),
  baselineBuild: oldBuild, candidateBuild: newBuild,
  baselineSourceFingerprint: oldBuild, candidateSourceFingerprint: newBuild,
});

test('accepts full independent comparable lab runs bound to their source releases', () => {
  assert.deepEqual(validateActivationReports(evidence()), []);
});
test('rejects missing, self-repeated, stale source, and unbound reports', () => {
  for (const change of [
    value => { value.candidate.samples.pop(); },
    value => { value.repeat = value.baseline; },
    value => { value.candidate.sourceBuild = oldBuild; },
    value => { delete value.candidate.sourceBinding; },
    value => { value.repeat.sourceFingerprint = newBuild; },
    value => { value.candidate.static.build = 'lab-candidate'; },
    value => { value.candidate.sourceVerification.unchangedFilesChecked = 0; },
  ]) {
    const value = evidence(); change(value);
    assert.ok(validateActivationReports(value).length);
  }
});
test('blocks planted added script, 100 ms tap, and new polling regressions', () => {
  const script = evidence(); script.candidate.static.sharedGzipBytes += 30000;
  assert.match(validateActivationReports(script).join('\n'), /sharedGzipBytes/);
  const tap = evidence();
  for (const sample of tap.candidate.samples) if (sample.journey === 'openjob') sample.durationMs += 100;
  assert.match(validateActivationReports(tap).join('\n'), /openjob/);
  const poll = evidence(); poll.candidate.static.idlePolls++;
  assert.match(validateActivationReports(poll).join('\n'), /idlePolls/);
});

test('checks actual immutable history, compressed bytes, and changed gzip payload', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'foremanhq-activation-test-'));
  try {
    const before = path.join(dir, 'before'), after = path.join(dir, 'after');
    for (const [root, id] of [[before, oldBuild], [after, newBuild]]) {
      await mkdir(path.join(root, 'static/chunks'), { recursive: true });
      await writeFile(path.join(root, 'BUILD_ID'), id);
      await writeFile(path.join(root, 'release-assets.json'), JSON.stringify({
        builder: 'webpack', sourceHash: id,
        currentScripts: root === before ? ['chunks/old.js'] : ['chunks/new.js'],
      }));
      await writeFile(path.join(root, 'static/chunks/old.js'), 'old fixture');
    }
    const content = Buffer.from('new fixture');
    const next = path.join(after, 'static/chunks/new.js');
    await writeFile(next, content);
    await writeFile(next + '.br', brotliCompressSync(content));
    await writeFile(next + '.gz', gzipSync(content, { level: 9 }));
    const result = await inspectReleaseAssets(before, after);
    assert.equal(result.retainedFiles, 1);
    assert.equal(result.changedGzipBytes, gzipSync(content, { level: 9 }).length);
    await writeFile(path.join(after, 'static/chunks/old.js'), 'changed immutable fixture');
    await assert.rejects(inspectReleaseAssets(before, after), /immutable asset changed/);
    await writeFile(path.join(after, 'static/chunks/old.js'), 'old fixture');
    await writeFile(next + '.br', brotliCompressSync(Buffer.from('wrong bytes')));
    await assert.rejects(inspectReleaseAssets(before, after), /Compressed bytes/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
