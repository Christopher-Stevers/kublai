const cancellations = new Set<() => void>();

/** Register CPU work containing account data without retaining the data here. */
export function registerPrivateBackgroundWork(cancel: () => void) {
  cancellations.add(cancel);
  return () => cancellations.delete(cancel);
}

export function clearPrivateBackgroundWork() {
  for (const cancel of [...cancellations]) cancel();
}
