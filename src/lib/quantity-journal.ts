/** Write-ahead recovery for Replicache's deferred on-disk persistence. */
export type QuantityIntent = {
  materialListId: string;
  itemId: string;
  quantity: number;
  token: string;
};
type Row = { quantity?: string; pendingSync?: boolean } | undefined;
type Store = {
  apply: (intent: QuantityIntent) => Promise<unknown>;
  observe: (itemId: string, onData: (row: Row) => void) => () => void;
  sync: () => void;
};
export class QuantityJournal {
  private watchers = new Map<string, () => void>();
  private prefix: string;
  constructor(
    scope: string,
    private storage: Storage,
    private store: Store,
  ) {
    this.prefix = `foremanhq.quantity-intent.v1:${scope}:`;
  }
  private read(itemId: string) {
    const raw = this.storage.getItem(this.prefix + itemId);
    if (!raw) return null;
    try {
      const intent = JSON.parse(raw) as QuantityIntent;
      return intent.itemId === itemId &&
        typeof intent.materialListId === "string" &&
        typeof intent.token === "string" &&
        Number.isSafeInteger(intent.quantity) &&
        intent.quantity > 0
        ? intent
        : null;
    } catch {
      return null;
    }
  }
  private watch(intent: QuantityIntent, replay: boolean) {
    if (this.read(intent.itemId)?.token !== intent.token) return;
    this.watchers.get(intent.itemId)?.();
    const finish = () => {
      stop();
      if (this.watchers.get(intent.itemId) === stop)
        this.watchers.delete(intent.itemId);
    };
    const stop = this.store.observe(intent.itemId, (row) => {
      if (this.read(intent.itemId)?.token !== intent.token) {
        finish();
        return;
      }
      if (!row) return; // The cached row may arrive after initial pull.
      if (replay) {
        replay = false;
        void this.store
          .apply(intent)
          .then(this.store.sync)
          .catch((error) => console.error("Quantity recovery failed", error));
        return;
      }
      // Only discard the journal after the canonical server row is visible.
      if (!row.pendingSync && Number(row.quantity) === intent.quantity) {
        if (this.read(intent.itemId)?.token === intent.token)
          this.storage.removeItem(this.prefix + intent.itemId);
        finish();
      }
    });
    this.watchers.set(intent.itemId, stop);
  }
  async save(input: Omit<QuantityIntent, "token">) {
    const intent = { ...input, token: crypto.randomUUID() };
    // This synchronous write survives navigation before Replicache's idle flush.
    this.storage.setItem(this.prefix + intent.itemId, JSON.stringify(intent));
    this.watchers.get(intent.itemId)?.();
    await this.store.apply(intent);
    this.watch(intent, false);
    this.store.sync();
  }
  recover() {
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (!key?.startsWith(this.prefix)) continue;
      const intent = this.read(key.slice(this.prefix.length));
      if (intent) this.watch(intent, true);
    }
  }
  close() {
    for (const stop of this.watchers.values()) stop();
    this.watchers.clear();
  }
}
