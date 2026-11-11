/** Per-screen ordering guard for ephemeral UI intents and bulk receipt writes. */
export function createReceiptIntentGate() {
  const counts = new Map<string, number>();
  let bulk = false;
  return {
    change(id: string, active: boolean) {
      const count = Math.max(0, (counts.get(id) ?? 0) + (active ? 1 : -1));
      if (count) counts.set(id, count);
      else counts.delete(id);
    },
    canStartReceipt: () => !bulk,
    hasQueued: () => counts.size > 0,
    tryStartBulk(hasPendingWrite: boolean, online = true) {
      if (!online || bulk || counts.size || hasPendingWrite) return false;
      bulk = true;
      return true;
    },
    finishBulk() {
      bulk = false;
    },
  };
}
