import { afterEach, expect, it, vi } from "vitest";
import {
  NavigationPaintCoordinator,
  installNavigationInput,
  navigationPaint,
} from "./navigation-paint";
const coordinators: NavigationPaintCoordinator[] = [];
function fixture() {
  let now = 100,
    path = "/jobs",
    active = true,
    loading = false,
    serial = 0;
  const frames = new Map<number, () => void>(),
    watchers = new Set<() => void>(),
    emit = vi.fn();
  const coordinator = new NavigationPaintCoordinator({
    now: () => now,
    path: () => path,
    active: () => active,
    loading: () => loading,
    frame: (fn) => {
      frames.set(++serial, fn);
      return serial;
    },
    cancelFrame: (id) => {
      frames.delete(id);
    },
    watch: (fn) => {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
    emit,
  });
  coordinators.push(coordinator);
  const frame = () => {
    now += 16;
    const ready = [...frames.values()];
    frames.clear();
    for (const fn of ready) fn();
  };
  return {
    coordinator,
    emit,
    frame,
    frames,
    watchers,
    path: (value: string) => {
      path = value;
    },
    active: (value: boolean) => {
      active = value;
    },
    loading: (value: boolean) => {
      loading = value;
      for (const fn of [...watchers]) fn();
    },
  };
}
afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.cancel();
});
it("requires a real input dispatch and a separate committed transition", () => {
  const f = fixture();
  expect(f.coordinator.claimLocal()).toBeNull();
  f.coordinator.beginInput(false);
  expect(f.coordinator.claimLocal()).toBeNull();
  const input = f.coordinator.beginInput(true);
  f.coordinator.endDispatch(input);
  expect(f.coordinator.claimLocal()).toBeNull();
  f.coordinator.beginInput(true);
  const ticket = f.coordinator.claimLocal()!;
  f.frame();
  f.frame();
  expect(f.emit).not.toHaveBeenCalled();
  ticket.commit();
  f.frame();
  expect(f.emit).not.toHaveBeenCalled();
  f.frame();
  expect(f.emit).toHaveBeenCalledTimes(1);
});
it("does not count a committed loading shell; waits for readiness and two frame opportunities", () => {
  const f = fixture();
  f.loading(true);
  f.coordinator.beginInput(true);
  const ticket = f.coordinator.claimLocal()!;
  ticket.commit();
  f.frame();
  f.frame();
  expect(f.emit).not.toHaveBeenCalled();
  f.loading(false);
  f.frame();
  f.loading(true);
  f.frame();
  expect(f.emit).not.toHaveBeenCalled();
  f.loading(false);
  f.frame();
  f.frame();
  expect(f.emit).toHaveBeenCalledTimes(1);
  expect(f.watchers.size).toBe(0);
});
it("superseding input cancels old work without an old cleanup canceling its replacement", () => {
  const f = fixture();
  f.coordinator.beginInput(true);
  const old = f.coordinator.claimLocal()!;
  old.commit();
  f.frame();
  f.coordinator.beginInput(true);
  const next = f.coordinator.claimLocal()!;
  next.commit();
  old.cancel();
  f.frame();
  f.frame();
  expect(f.emit).toHaveBeenCalledTimes(1);
});
it("shares one owner across local and pathname commits", () => {
  const f = fixture();
  f.coordinator.beginInput(true);
  const local = f.coordinator.claimLocal()!;
  local.commit();
  f.path("/jobs/another");
  f.coordinator.commitPath("/jobs/another");
  local.cancel();
  f.frame();
  f.frame();
  expect(f.emit).toHaveBeenCalledTimes(1);
  f.coordinator.commitPath("/jobs/another");
  f.frame();
  f.frame();
  expect(f.emit).toHaveBeenCalledTimes(1);
});
it("canceled, paused, hidden or removed owners never emit later", () => {
  for (const reason of ["cancel", "pause", "unmount"]) {
    const f = fixture();
    f.coordinator.beginInput(true);
    const ticket = f.coordinator.claimLocal()!;
    ticket.commit();
    if (reason === "pause") f.active(false);
    else if (reason === "unmount") ticket.cancel();
    else f.coordinator.cancel();
    f.frame();
    f.frame();
    f.active(true);
    ticket.commit();
    f.frame();
    f.frame();
    expect(f.emit).not.toHaveBeenCalled();
    expect(f.watchers.size).toBe(0);
  }
});
it("programmatic pathname changes without user input create no observation", () => {
  const f = fixture();
  f.path("/jobs/programmatic");
  f.coordinator.commitPath("/jobs/programmatic");
  f.frame();
  f.frame();
  expect(f.emit).not.toHaveBeenCalled();
});

it("the installed event boundary rejects synthetic input and canceled compatibility clicks", () => {
  const add = vi.spyOn(document, "addEventListener");
  const element = document.createElement("button");
  document.body.append(element);
  const stop = installNavigationInput();
  const listener = (type: string) => {
    const callback = add.mock.calls.find((row) => row[0] === type)?.[1];
    if (typeof callback !== "function") throw Error("Missing input listener");
    return callback;
  };
  try {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail: 1 }),
    );
    expect(navigationPaint.claimLocal()).toBeNull();
    // Injected trusted-event metadata tests the listener policy, not browser trust.
    listener("pointerdown")({
      isTrusted: true,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 1,
      clientY: 1,
      target: element,
    } as unknown as Event);
    const ticket = navigationPaint.claimLocal();
    expect(ticket).not.toBeNull();
    ticket?.cancel();
    window.dispatchEvent(new Event("scroll"));
    listener("click")({
      isTrusted: true,
      button: 0,
      detail: 1,
      target: element,
    } as unknown as Event);
    expect(navigationPaint.claimLocal()).toBeNull();
  } finally {
    stop();
    element.remove();
    add.mockRestore();
  }
});
it("a real activation key can own its synchronous synthetic click, but programmatic popstate cannot", async () => {
  const add = vi.spyOn(document, "addEventListener"),
    element = document.createElement("button");
  document.body.append(element);
  const stop = installNavigationInput();
  try {
    const callback = add.mock.calls.find((row) => row[0] === "keydown")?.[1];
    if (typeof callback !== "function") throw Error("Missing key listener");
    callback({
      isTrusted: true,
      key: "Enter",
      target: element,
    } as unknown as Event);
    element.click();
    const ticket = navigationPaint.claimLocal();
    expect(ticket).not.toBeNull();
    ticket?.cancel();
    await Promise.resolve();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(navigationPaint.claimLocal()).toBeNull();
  } finally {
    stop();
    element.remove();
    add.mockRestore();
  }
});

it("restoration scroll after claim/commit preserves observation, but scrolling before release cannot claim", () => {
  const f = fixture();
  f.coordinator.beginInput(true);
  f.coordinator.scroll();
  expect(f.coordinator.claimLocal()).toBeNull();
  f.coordinator.beginInput(true);
  const ticket = f.coordinator.claimLocal()!;
  f.coordinator.scroll();
  ticket.commit();
  f.coordinator.scroll();
  f.frame();
  f.coordinator.scroll();
  f.frame();
  expect(f.emit).toHaveBeenCalledTimes(1);
});
it("malformed anchor URLs cannot throw from telemetry's real-input listener", () => {
  const add = vi.spyOn(document, "addEventListener"),
    anchor = document.createElement("a");
  anchor.setAttribute("href", "http://[");
  document.body.append(anchor);
  const stop = installNavigationInput();
  try {
    const callback = add.mock.calls.find((row) => row[0] === "click")?.[1];
    if (typeof callback !== "function") throw Error("Missing click listener");
    expect(() =>
      callback({
        isTrusted: true,
        button: 0,
        detail: 0,
        target: anchor,
      } as unknown as Event),
    ).not.toThrow();
    navigationPaint.cancel();
  } finally {
    stop();
    anchor.remove();
    add.mockRestore();
  }
});
it("fresh real wheel input cancels a claimed navigation while synthetic wheel does not", () => {
  const add = vi.spyOn(window, "addEventListener"),
    stop = installNavigationInput();
  try {
    const callback = add.mock.calls.find((row) => row[0] === "wheel")?.[1];
    if (typeof callback !== "function") throw Error("Missing wheel listener");
    navigationPaint.beginInput(true);
    expect(navigationPaint.claimLocal()).not.toBeNull();
    callback({ isTrusted: false } as unknown as Event);
    expect(navigationPaint.scroll()).toBe(true);
    callback({ isTrusted: true } as unknown as Event);
    expect(navigationPaint.scroll()).toBe(false);
    expect(navigationPaint.claimLocal()).toBeNull();
  } finally {
    stop();
    add.mockRestore();
  }
});
