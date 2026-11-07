export type DrawingDownloadTask = {
  id: string;
  account: string;
  label: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  progress: string;
};
type Work = (
  signal: AbortSignal,
  progress: (message: string) => void,
) => Promise<void>;
/** Transfers belong to the app session, never to the page that enqueued them. */
export class DrawingDownloadQueue {
  private entries = new Map<
    string,
    { task: DrawingDownloadTask; work: Work; controller: AbortController }
  >();
  private listeners = new Set<() => void>();
  private snapshot: DrawingDownloadTask[] = [];
  constructor(private concurrency = 2) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish() {
    this.snapshot = [...this.entries.values()].map((entry) => ({
      ...entry.task,
    }));
    for (const listener of this.listeners) listener();
  }
  enqueue(
    task: Pick<DrawingDownloadTask, "id" | "account" | "label">,
    work: Work,
  ) {
    const previous = this.entries.get(task.id);
    if (previous && ["queued", "running"].includes(previous.task.status))
      return;
    this.entries.set(task.id, {
      task: { ...task, status: "queued", progress: "Queued" },
      work,
      controller: new AbortController(),
    });
    this.publish();
    this.drain();
  }
  cancel(id: string) {
    const entry = this.entries.get(id);
    if (!entry || !["queued", "running"].includes(entry.task.status)) return;
    entry.controller.abort();
    if (entry.task.status === "queued") {
      entry.task.status = "cancelled";
      entry.work = async () => undefined;
    }
    entry.task.progress = "Cancelled";
    this.publish();
    this.drain();
  }
  cancelOtherAccounts(account: string | null) {
    for (const entry of this.entries.values())
      if (entry.task.account !== account) this.cancel(entry.task.id);
  }
  dismiss(id: string) {
    const entry = this.entries.get(id);
    if (entry && !["queued", "running"].includes(entry.task.status)) {
      this.entries.delete(id);
      this.publish();
    }
  }
  private drain() {
    let running = [...this.entries.values()].filter(
      (e) => e.task.status === "running",
    ).length;
    for (const entry of this.entries.values()) {
      if (running >= this.concurrency) break;
      if (entry.task.status !== "queued") continue;
      running++;
      entry.task.status = "running";
      entry.task.progress = "Preparing…";
      this.publish();
      void Promise.resolve()
        .then(() => {
          entry.controller.signal.throwIfAborted();
          return entry.work(entry.controller.signal, (message) => {
            if (!entry.controller.signal.aborted) {
              entry.task.progress = message;
              this.publish();
            }
          });
        })
        .then(() => {
          entry.controller.signal.throwIfAborted();
          entry.task.status = "complete";
          entry.task.progress = "Downloaded";
          if (typeof window !== "undefined")
            window.dispatchEvent(
              new Event("foremanhq-drawing-downloads-changed"),
            );
        })
        .catch((error: unknown) => {
          entry.task.status = entry.controller.signal.aborted
            ? "cancelled"
            : "failed";
          entry.task.progress = entry.controller.signal.aborted
            ? "Cancelled"
            : error instanceof Error
              ? error.message
              : "Download failed";
        })
        .finally(() => {
          // Release captured page data once the transfer ends.
          entry.work = async () => undefined;
          const finished = [...this.entries.values()].filter(
            (e) =>
              e.task.status === "complete" || e.task.status === "cancelled",
          );
          for (const old of finished.slice(
            0,
            Math.max(0, finished.length - 20),
          ))
            this.entries.delete(old.task.id);
          this.publish();
          this.drain();
        });
    }
  }
}
export const drawingDownloadQueue = new DrawingDownloadQueue();
if (typeof window !== "undefined")
  window.addEventListener(
    "foremanhq-drawing-offline-binding-change",
    (event) => {
      drawingDownloadQueue.cancelOtherAccounts(
        (event as CustomEvent<{ accountKey: string | null }>).detail.accountKey,
      );
    },
  );
