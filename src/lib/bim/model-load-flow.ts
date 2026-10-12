/** One chunk in flight: the parser must wait until the viewer has consumed it. */
export class ModelLoadFlow {
  readonly controller = new AbortController();
  private pending: { id: number; complete: () => void } | null = null;
  get signal() {
    return this.controller.signal;
  }
  check() {
    this.signal.throwIfAborted();
  }
  cancel() {
    this.controller.abort();
  }
  acknowledge(id: number) {
    if (this.pending?.id === id) this.pending.complete();
  }
  waitForChunk(id: number) {
    this.check();
    if (this.pending) throw Error("A geometry chunk is already in flight.");
    return new Promise<void>((resolve, reject) => {
      const cancel = () => {
        this.pending = null;
        reject(new DOMException("Model loading canceled.", "AbortError"));
      };
      this.signal.addEventListener("abort", cancel, { once: true });
      this.pending = {
        id,
        complete: () => {
          this.signal.removeEventListener("abort", cancel);
          this.pending = null;
          resolve();
        },
      };
    });
  }
  async yield() {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    this.check();
  }
}
