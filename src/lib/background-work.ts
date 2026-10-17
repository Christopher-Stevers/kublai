/** Small, interruptible warmups. Foreground imports and visible images bypass this queue. */
type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
type BackgroundNavigator = Navigator & {
  connection?: Connection;
  scheduling?: { isInputPending?: () => boolean };
};

export function canWarmInBackground() {
  if (
    typeof window === "undefined" ||
    !navigator.onLine ||
    document.visibilityState === "hidden"
  )
    return false;
  const connection = (navigator as BackgroundNavigator).connection;
  return (
    !connection?.saveData &&
    !["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "")
  );
}

const jobs = new Map<unknown, () => Promise<unknown>>();
let running = false;
let listening = false;
let quietUntil = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const pointers = new Set<number>();

function schedule(delay = 500) {
  if (timer || running || !jobs.size) return;
  timer = setTimeout(() => void tick(), delay);
}
function activity(event: Event) {
  quietUntil = Date.now() + 1500;
  if (event.type === "pointerdown")
    pointers.add((event as PointerEvent).pointerId);
  if (event.type === "pointerup" || event.type === "pointercancel")
    pointers.delete((event as PointerEvent).pointerId);
  schedule();
}
function resume() {
  if (document.visibilityState === "hidden") pointers.clear();
  schedule();
}
function listen() {
  if (listening) return;
  listening = true;
  quietUntil = Date.now() + 6000;
  for (const event of [
    "pointerdown",
    "pointerup",
    "pointercancel",
    "pointermove",
    "keydown",
    "wheel",
    "scroll",
  ])
    window.addEventListener(event, activity, { passive: true, capture: true });
  window.addEventListener("online", resume);
  window.addEventListener("blur", () => {
    pointers.clear();
  });
  document.addEventListener("visibilitychange", resume);
  (navigator as BackgroundNavigator).connection?.addEventListener(
    "change",
    resume,
  );
}
async function tick() {
  timer = undefined;
  if (!canWarmInBackground()) return; // online/visibility/connection events resume it
  if (
    pointers.size ||
    Date.now() < quietUntil ||
    (navigator as BackgroundNavigator).scheduling?.isInputPending?.()
  ) {
    schedule(500);
    return;
  }
  // Idle callbacks avoid competing with rendering. Recheck activity afterwards.
  if ("requestIdleCallback" in window) {
    running = true;
    await new Promise<void>((resolve) =>
      window.requestIdleCallback(() => resolve(), { timeout: 2000 }),
    );
    running = false;
    if (!canWarmInBackground() || pointers.size || Date.now() < quietUntil) {
      schedule();
      return;
    }
  }
  const entry = jobs.entries().next().value;
  if (!entry) return;
  const [key, work] = entry;
  jobs.delete(key);
  running = true;
  try {
    await work();
  } catch {
    /* A later online/snapshot event can retry a warmup. */
  } finally {
    running = false;
    schedule();
  }
}

export function scheduleBackgroundWork(
  key: unknown,
  work: () => Promise<unknown>,
) {
  if (typeof window === "undefined") return () => undefined;
  listen();
  jobs.set(key, work);
  schedule();
  return () => {
    if (jobs.get(key) === work) jobs.delete(key);
  };
}
