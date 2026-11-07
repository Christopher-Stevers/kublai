export const OFFLINE_TEST_KEY = "foremanhq.offline-test";
export function isOfflineTestEnabled() {
  try {
    return (
      typeof window !== "undefined" &&
      localStorage.getItem(OFFLINE_TEST_KEY) === "1"
    );
  } catch {
    return false;
  }
}
export async function setOfflineTestEnabled(enabled: boolean) {
  const worker = navigator.serviceWorker?.controller;
  if (!worker)
    throw Error(
      "Offline support is still loading. Reload ForemanHQ once, then try again.",
    );
  // Do not leave the worker offline if this browser cannot retain the recovery flag.
  const previous = localStorage.getItem(OFFLINE_TEST_KEY);
  localStorage.setItem(OFFLINE_TEST_KEY, previous ?? "0");
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(
        Error("Offline support did not respond. Reload ForemanHQ and retry."),
      );
    }, 15000);
    channel.port1.onmessage = (
      event: MessageEvent<{ ok?: boolean; error?: string }>,
    ) => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data.ok) resolve();
      else reject(Error(event.data.error ?? "Could not change offline mode."));
    };
    worker.postMessage({ type: "FOREMANHQ_OFFLINE_TEST_SET", enabled }, [
      channel.port2,
    ]);
  });
  localStorage.setItem(OFFLINE_TEST_KEY, enabled ? "1" : "0");
  window.dispatchEvent(new Event(enabled ? "offline" : "online"));
  window.location.reload();
}
