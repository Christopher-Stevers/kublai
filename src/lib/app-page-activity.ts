/** Cooperative pause for retained internal pages. Never cancels writes or uploads. */
export const APP_PAGE_ACTIVITY = "foremanhq-page-activity";
let selected = true;
export const isAppPageActive = () => selected && (typeof document === "undefined" || document.visibilityState !== "hidden");
export function setAppPageActive(value: boolean) {
  if (selected === value) return;
  selected = value;
  document.documentElement.toggleAttribute("data-internal-page-paused", !value);
  window.dispatchEvent(new Event(APP_PAGE_ACTIVITY));
}
export function subscribeAppPageActivity(callback: () => void) {
  window.addEventListener(APP_PAGE_ACTIVITY, callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    window.removeEventListener(APP_PAGE_ACTIVITY, callback);
    document.removeEventListener("visibilitychange", callback);
  };
}
const intervals = new Map<number, () => void>();
let nextInterval = 0;
export function setPageInterval(callback: () => void, delay: number) {
  const id = ++nextInterval;
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  const update = () => {
    if (!isAppPageActive()) {
      if (timer !== undefined) globalThis.clearInterval(timer);
      timer = undefined;
    } else if (timer === undefined) {
      timer = globalThis.setInterval(callback, delay);
      callback();
    }
  };
  if (isAppPageActive()) timer = globalThis.setInterval(callback, delay);
  const unsubscribe = subscribeAppPageActivity(update);
  intervals.set(id, () => { unsubscribe(); if (timer !== undefined) globalThis.clearInterval(timer); });
  return id;
}
export function clearPageInterval(id: number | undefined) {
  if (id === undefined) return;
  intervals.get(id)?.();
  intervals.delete(id);
}
let nextFrame = 0;
const frames = new Map<number, () => void>();
export function requestPageAnimationFrame(callback: FrameRequestCallback) {
  const id = ++nextFrame;
  let frame: number | undefined;
  const update = () => {
    if (!isAppPageActive()) {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
    } else if (frame === undefined) {
      frame = window.requestAnimationFrame(time => {
        unsubscribe();
        frames.delete(id);
        callback(time);
      });
    }
  };
  const unsubscribe = subscribeAppPageActivity(update);
  frames.set(id, () => { unsubscribe(); if (frame !== undefined) window.cancelAnimationFrame(frame); });
  update();
  return id;
}
export function cancelPageAnimationFrame(id: number) {
  frames.get(id)?.();
  frames.delete(id);
}
