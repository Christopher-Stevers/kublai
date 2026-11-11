import { isAppPageActive, subscribeAppPageActivity } from "./app-page-activity";
import { speedScreen, type SPEED_SCREENS } from "./speed-telemetry";
type Screen = (typeof SPEED_SCREENS)[number];
export type PaintTicket = { commit: () => void; cancel: () => void };
type Input = {
  start: number;
  path: string;
  route?: string;
  consumed: boolean;
  emitted: boolean;
};
type Pending = {
  input: Input;
  kind: "local" | "route";
  frame: number;
  stop: () => void;
  timeout: ReturnType<typeof setTimeout> | undefined;
};
type Environment = {
  now: () => number;
  path: () => string;
  active: () => boolean;
  loading: () => boolean;
  frame: (fn: () => void) => number;
  cancelFrame: (id: number) => void;
  watch: (fn: () => void) => () => void;
  emit: (start: number, end: number) => void;
};
/** One input/observation owner shared by local React commits and pathname commits.
 * No route, target, account or record identity enters a measure or context event. */
export class NavigationPaintCoordinator {
  private input: Input | null = null;
  private dispatch: Input | null = null;
  private pending: Pending | null = null;
  constructor(private env: Environment) {}
  beginInput(trusted: boolean, route?: string) {
    if (!trusted || !this.env.active()) return;
    this.cancel();
    this.input = {
      start: this.env.now(),
      path: this.env.path(),
      route,
      consumed: false,
      emitted: false,
    };
    this.dispatch = this.input;
    return this.input;
  }
  continueInput(trusted: boolean, route?: string) {
    if (!trusted || !this.env.active()) return;
    if (
      !this.input ||
      this.input.emitted ||
      this.env.now() - this.input.start > 5000
    )
      return this.beginInput(true, route);
    this.input.route = route;
    this.dispatch = this.input;
    return this.input;
  }
  endDispatch(input: unknown) {
    if (this.dispatch === input) this.dispatch = null;
  }
  cancel() {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      this.env.cancelFrame(pending.frame);
      pending.stop();
      clearTimeout(pending.timeout);
    }
    this.input = null;
    this.dispatch = null;
  }
  scroll() {
    // Before claim, scrolling cancels a row gesture. After claim, a scroll event
    // may be destination/back restoration; do not infer fresh user intent from it.
    if (this.pending) return true;
    this.cancel();
    return false;
  }
  private ticket(input: Input, kind: Pending["kind"]): PaintTicket {
    const old = this.pending;
    if (old) {
      this.env.cancelFrame(old.frame);
      old.stop();
      clearTimeout(old.timeout);
    }
    const pending: Pending = {
      input,
      kind,
      frame: 0,
      stop: () => undefined,
      timeout: undefined,
    };
    this.pending = pending;
    input.consumed = true;
    const valid = () =>
      this.pending === pending &&
      this.env.active() &&
      !input.emitted &&
      this.env.now() - input.start <= 30_000 &&
      (kind === "route"
        ? this.env.path() === input.route
        : this.env.path() === input.path);
    let committed = false,
      scheduled = false;
    const check = () => {
      if (!valid()) {
        if (this.pending === pending) this.cancel();
        return;
      }
      if (!committed || scheduled || this.env.loading()) return;
      scheduled = true;
      pending.frame = this.env.frame(() => {
        pending.frame = this.env.frame(() => {
          scheduled = false;
          if (!valid()) {
            if (this.pending === pending) this.cancel();
            return;
          }
          if (this.env.loading()) return;
          input.emitted = true;
          this.pending = null;
          pending.stop();
          clearTimeout(pending.timeout);
          this.env.emit(input.start, this.env.now());
        });
      });
    };
    pending.stop = this.env.watch(check);
    pending.timeout = setTimeout(() => {
      if (this.pending === pending) this.cancel();
    }, 30_000);
    return {
      commit: () => {
        if (committed) return;
        committed = true;
        check();
      },
      cancel: () => {
        if (this.pending === pending) this.cancel();
      },
    };
  }
  claimLocal(): PaintTicket | null {
    const input = this.dispatch;
    if (
      !input ||
      input.emitted ||
      (input.consumed && this.pending?.kind !== "route")
    )
      return null;
    return this.ticket(input, "local");
  }
  commitPath(path: string) {
    const input = this.input;
    // Retain the existing bounded pathname correlation for a real input. Local
    // claims remain stricter: they must occur during that event's dispatch.
    if (!input || input.emitted || this.env.now() - input.start > 5000) {
      if (this.pending) this.cancel();
      return;
    }
    input.route = path;
    const ticket = this.ticket(input, "route");
    ticket.commit();
  }
}
let localScreen: Screen | null = null;
const contexts = new Set<() => void>();
export const navigationScreen = () =>
  localScreen ?? speedScreen(window.location.pathname);
export const subscribeNavigationScreen = (callback: () => void) => {
  contexts.add(callback);
  return () => {
    contexts.delete(callback);
  };
};
export function setLocalNavigationScreen(screen: Screen | null) {
  if (localScreen === screen) return;
  localScreen = screen;
  for (const callback of contexts) callback();
}
function loading() {
  return [
    ...document.querySelectorAll(
      '[data-route-loading],[data-app-startup-loading],[data-workspace-loading],[data-slot="skeleton"],.skeleton-shimmer',
    ),
  ].some(
    (element) =>
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden",
  );
}
export const navigationPaint = new NavigationPaintCoordinator({
  now: () => performance.now(),
  path: () => window.location.pathname,
  active: isAppPageActive,
  loading,
  frame: (fn) => requestAnimationFrame(fn),
  cancelFrame: (id) => cancelAnimationFrame(id),
  watch: (fn) => {
    const observer = new MutationObserver(fn);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "style", "class", "data-workspace-loading"],
    });
    return () => observer.disconnect();
  },
  emit: (start, end) =>
    performance.measure("foremenhq:tap-to-paint", { start, end }),
});
/** Only real event dispatch can initiate a local measurement. A synthetic click
 * inside a real activation key keeps that key's provenance; standalone fake
 * clicks, restore events and programmatic history calls cannot create one. */
export function installNavigationInput() {
  let cancelledGesture = false;
  let keyboardOwner: Element | null = null;
  let pointer: {
    id: number;
    x: number;
    y: number;
    owner: Element | null;
  } | null = null;
  const control = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest('a,button,[role="button"]')
      : null;
  const route = (target: EventTarget | null) => {
    const anchor = target instanceof Element ? target.closest("a[href]") : null;
    if (!anchor) return undefined;
    try {
      const url = new URL(
        anchor.getAttribute("href") ?? "",
        window.location.href,
      );
      return url.origin === window.location.origin &&
        url.pathname !== location.pathname
        ? url.pathname
        : undefined;
    } catch {
      return undefined;
    }
  };
  const dispatch = (input: unknown) => {
    if (input) queueMicrotask(() => navigationPaint.endDispatch(input));
  };
  const down = (event: PointerEvent) => {
    if (
      !event.isTrusted ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    cancelledGesture = false;
    keyboardOwner = null;
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      owner: control(event.target),
    };
    dispatch(navigationPaint.beginInput(true, route(event.target)));
  };
  const click = (event: MouseEvent) => {
    if (
      !event.isTrusted ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (cancelledGesture && event.detail > 0) return;
    if (pointer && pointer.owner !== control(event.target)) {
      const replaced = pointer.owner && !pointer.owner.isConnected;
      pointer = null;
      if (!replaced) navigationPaint.cancel();
      return;
    }
    const continuation =
      pointer !== null ||
      (keyboardOwner !== null && keyboardOwner === control(event.target));
    dispatch(
      continuation
        ? navigationPaint.continueInput(true, route(event.target))
        : navigationPaint.beginInput(true, route(event.target)),
    );
    pointer = null;
    keyboardOwner = null;
  };
  const key = (event: KeyboardEvent) => {
    if (
      !event.isTrusted ||
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      !["Enter", " ", "Escape"].includes(event.key) ||
      (event.key !== "Escape" && !control(event.target))
    )
      return;
    cancelledGesture = false;
    pointer = null;
    keyboardOwner = control(event.target);
    dispatch(navigationPaint.beginInput(true, route(event.target)));
  };
  const cancel = () => {
    cancelledGesture = true;
    pointer = null;
    keyboardOwner = null;
    navigationPaint.cancel();
  };
  const move = (event: PointerEvent) => {
    if (
      pointer?.id === event.pointerId &&
      Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10
    )
      cancel();
  };
  const scroll = () => {
    if (!navigationPaint.scroll()) {
      cancelledGesture = true;
      pointer = null;
      keyboardOwner = null;
    }
  };
  const wheel = (event: WheelEvent) => {
    if (event.isTrusted) cancel();
  };
  const activity = () => {
    if (!isAppPageActive()) cancel();
  };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("scroll", scroll, true);
  window.addEventListener("wheel", wheel, { passive: true, capture: true });
  const stop = subscribeAppPageActivity(activity);
  return () => {
    cancel();
    stop();
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("scroll", scroll, true);
    window.removeEventListener("wheel", wheel, true);
  };
}
