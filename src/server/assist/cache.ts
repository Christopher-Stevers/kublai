/** Bounded, process-local result reuse; failures never become cached answers. */
export class AsyncResultCache<T> {
  private entries = new Map<string, { promise: Promise<T>; expires: number }>();
  constructor(
    private limit = 32,
    private ttl = 5 * 60_000,
  ) {}
  get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expires > Date.now()) return existing.promise;
    if (existing) this.entries.delete(key);
    const entry = {
      promise: undefined as unknown as Promise<T>,
      expires: Infinity,
    };
    entry.promise = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          entry.expires = Date.now() + this.ttl;
          this.prune();
          return value;
        },
        (error) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      );
    this.entries.set(key, entry);
    this.prune();
    return entry.promise;
  }
  private prune() {
    // Admission limits cap in-flight work; evict completed entries on settlement too.
    for (const [id, value] of this.entries) {
      if (this.entries.size <= this.limit) break;
      if (value.expires !== Infinity) this.entries.delete(id);
    }
  }
}
