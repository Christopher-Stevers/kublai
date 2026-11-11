import path from 'node:path';
import { realpath, readdir, lstat, readlink } from 'node:fs/promises';

async function resolved(target) {
  const absolute = path.resolve(target);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      if ((await lstat(absolute)).isSymbolicLink()) return resolved(path.resolve(path.dirname(absolute), await readlink(absolute)));
    } catch (nested) { if (nested.code !== 'ENOENT') throw nested; }
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(await resolved(parent), path.basename(absolute));
  }
}
export async function assertDisposableWorkspace(canonical, targets) {
  const workspace = await resolved(canonical);
  for (const [label, target] of Object.entries(targets)) {
    const actual = await resolved(target);
    const relative = path.relative(workspace, actual);
    if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw Error(`${label} is inside disposable canonical workspace; refusing cleanup`);
    }
  }
}

export async function assertInputSymlinks(canonical, inputs) {
  async function inspect(target) {
    let info;
    try { info = await lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) {
      await assertDisposableWorkspace(canonical, { inputSymlink: target });
      return;
    }
    if (info.isDirectory()) for (const name of await readdir(target)) await inspect(path.join(target, name));
  }
  for (const input of inputs) await inspect(input);
}
