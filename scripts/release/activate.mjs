#!/usr/bin/env node
import { readFile, realpath, lstat, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkActivation } from './activation-gate.mjs';
import { switchRelease } from './activation-switch.mjs';

const arg = name => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw Error(`Missing ${name}`);
  return process.argv[index + 1];
};
const root = await realpath(process.cwd());
const activeLink = path.join(root, '.next');
const lock = path.join(root, '.release-activation.lock');
let locked = false;
const restart = () => execFileSync('systemctl', ['--user', 'restart', 'foremenhq.service'], { stdio: 'inherit' });
async function healthy() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await fetch('http://localhost:3000/api/health', { signal: AbortSignal.timeout(1500), redirect: 'manual' });
      if (response.status === 200) return;
    } catch { /* The new process may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error('Candidate health check failed');
}
async function exactBytes(urlPath, diskPath) {
  const response = await fetch(`http://localhost:3000${urlPath}`, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
  if (response.status !== 200 || !Buffer.from(await response.arrayBuffer()).equals(await readFile(diskPath)))
    throw Error(`Activated runtime does not serve the expected ${urlPath}`);
}
try {
  if (!(await lstat(activeLink)).isSymbolicLink()) throw Error('Active .next must be a release symlink');
  const candidateDir = await realpath(arg('--candidate'));
  const read = async name => JSON.parse(await readFile(arg(name), 'utf8'));
  await mkdir(lock); locked = true;
  const previous = await realpath(activeLink);
  const evidence = await checkActivation({
    activeDir: previous, candidateDir,
    baseline: await read('--baseline'), repeat: await read('--repeat'), candidate: await read('--report'),
  });
  const command = execFileSync('systemctl', ['--user', 'show', 'foremenhq.service', '-p', 'ExecStart', '--value'], { encoding: 'utf8' });
  const workingDirectory = execFileSync('systemctl', ['--user', 'show', 'foremenhq.service', '-p', 'WorkingDirectory', '--value'], { encoding: 'utf8' }).trim();
  if (!command.includes('.next/runtime/release/start.mjs') || await realpath(workingDirectory) !== root)
    throw Error('Service must use the pinned release wrapper with this canonical working directory');
  await lstat(path.join(candidateDir, 'runtime/release/start.mjs'));
  if (await realpath(activeLink) !== previous) throw Error('Active release changed during validation');
  await writeFile(path.join(candidateDir, 'activation-preflight.json'), JSON.stringify({ ...evidence, checkedAt: new Date().toISOString(), previous }, null, 2) + '\n');
  await switchRelease({
    activeLink, previous, candidate: candidateDir, restart,
    checkCandidate: async () => {
      await healthy();
      const manifest = JSON.parse(await readFile(path.join(candidateDir, 'release-assets.json'), 'utf8'));
      const script = manifest.currentScripts[0];
      await exactBytes('/_next/static/' + script.split('/').map(encodeURIComponent).join('/'), path.join(candidateDir, 'static', script));
      await exactBytes('/sw.js', path.join(candidateDir, 'runtime/public/sw.js'));
    },
    checkRollback: healthy,
  });
  console.log(`Activated canonical build ${evidence.candidateBuild}. Field monitoring remains separate.`);
} catch (error) {
  console.error(`Release blocked: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (locked) await rm(lock, { recursive: true });
}
