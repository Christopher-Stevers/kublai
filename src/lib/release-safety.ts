// Numeric/read-only barriers: no account data is retained by update coordination.
const listeners = new Set<() => void>();
const checks = new Set<() => boolean | Promise<boolean>>();
let active = 0;
let revision = 0;
export function notifyReleaseWorkChange() { revision++; for (const listener of listeners) { try { listener(); } catch { /* Update observation must not fail user work. */ } } }
export function subscribeReleaseWork(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function holdReleaseWork() {
  active++; notifyReleaseWorkChange(); let ended = false;
  return () => { if (!ended) { ended = true; active--; notifyReleaseWorkChange(); } };
}
export function registerReleaseCheck(check: () => boolean | Promise<boolean>) { checks.add(check); }
export async function releaseWorkPending() {
  if (active) return true;
  const before = revision;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const blocked = await Promise.race([
      Promise.all([...checks].map(async check => { try { return await check(); } catch { return true; } })).then(results => results.some(Boolean)),
      new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(true), 1000); }),
    ]);
    return blocked || active > 0 || before !== revision;
  } finally { clearTimeout(timeout); }
}
