import { realpath, symlink, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function select(activeLink, target) {
  const temporary = path.join(path.dirname(activeLink), `.next-switch-${randomUUID()}`);
  try { await symlink(target, temporary); await rename(temporary, activeLink); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

/** Called only after the preflight and under the activation lock. Filesystem
 * switching is real; service/check callbacks make failure recovery testable. */
export async function switchRelease({ activeLink, previous, candidate, restart, checkCandidate, checkRollback }) {
  if (await realpath(activeLink) !== previous) throw Error('Active release changed during validation');
  await select(activeLink, candidate);
  try {
    await restart();
    await checkCandidate();
  } catch (error) {
    try {
      await select(activeLink, previous);
      await restart();
      await checkRollback();
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Activation failed; rollback needs attention: ${rollbackError.message}`);
    }
    throw new Error('Activation failed; previous release restored.', { cause: error });
  }
}
