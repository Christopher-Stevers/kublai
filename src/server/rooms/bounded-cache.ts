/** TTL/LRU cache with source-keyed in-flight deduplication and invalidation fencing. */
export class BoundedCache<T> {
  private entries = new Map<
    string,
    { value: T; bytes: number; expires: number }
  >();
  private pending = new Map<string, Promise<T>>();
  private bytes = 0;
  private activeBuilds = 0;
  constructor(
    private maxEntries: number,
    private maxBytes: number,
    private ttl: number,
    private maxPending = 2,
  ) {}
  private prune(now = Date.now()) {
    for (const [key, entry] of this.entries)
      if (entry.expires <= now) this.delete(key);
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const key = this.entries.keys().next().value;
      if (key === undefined) break;
      this.delete(key);
    }
  }
  delete(key: string) {
    const old = this.entries.get(key);
    if (old) this.bytes -= old.bytes;
    this.entries.delete(key);
    this.pending.delete(key);
  }
  invalidatePrefix(prefix: string) {
    for (const key of new Set([...this.entries.keys(), ...this.pending.keys()]))
      if (key.startsWith(prefix)) this.delete(key);
  }
  async get(
    key: string,
    build: () => Promise<T>,
    estimate: (value: T) => number,
  ) {
    this.prune();
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.activeBuilds >= this.maxPending) throw new Error("Other floor plans are being processed. Try again shortly.");
    this.activeBuilds++;
    const promise = Promise.resolve().then(build)
      .then((value) => {
        if (this.pending.get(key) === promise) {
          const bytes = estimate(value);
          if (bytes <= this.maxBytes) {
            this.entries.set(key, {
              value,
              bytes,
              expires: Date.now() + this.ttl,
            });
            this.bytes += bytes;
            this.prune();
          }
        }
        return value;
      })
      .finally(() => {
        this.activeBuilds--;
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
  sweep() {
    this.prune();
  }
  get size() {
    this.prune();
    return this.entries.size;
  }
}
