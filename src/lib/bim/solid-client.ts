import type { SolidRequest, SolidResult } from "./solid-kernel";
export function calculateSolid(
  request: SolidRequest,
  signal: AbortSignal,
): Promise<SolidResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Operation cancelled."));
      return;
    }
    const worker = new Worker(new URL("./solid.worker.ts", import.meta.url));
    const finish = (error?: string, result?: SolidResult) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      worker.terminate();
      if (error) reject(new Error(error));
      else if (result) resolve(result);
    };
    const cancel = () => finish("Operation cancelled.");
    const timer = setTimeout(
      () => finish("The operation took too long. Try a smaller selection."),
      60_000,
    );
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (
      e: MessageEvent<{ result?: SolidResult; error?: string }>,
    ) => finish(e.data.error, e.data.result);
    worker.onerror = () =>
      finish("The solid engine could not load. Reconnect and try again.");
    try {
      worker.postMessage(request);
    } catch {
      finish("The selected geometry could not be sent to the solid engine.");
    }
  });
}
