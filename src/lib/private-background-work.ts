import { notifyReleaseWorkChange, registerReleaseCheck } from "./release-safety";
const cancellations = new Set<() => void>();
registerReleaseCheck(() => cancellations.size > 0);

/** Register CPU work containing account data without retaining the data here. */
export function registerPrivateBackgroundWork(cancel: () => void) {
  cancellations.add(cancel);
  notifyReleaseWorkChange();
  return () => { const removed = cancellations.delete(cancel); notifyReleaseWorkChange(); return removed; };
}

export function clearPrivateBackgroundWork() {
  for (const cancel of [...cancellations]) cancel();
}
