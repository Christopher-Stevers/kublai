"use client";

import { useHeaderBackOverride } from "~/lib/header-back-events";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { learnWheelHand, type WheelHand } from "./quick-wheel-hand";
import Image from "next/image";
import { ArrowLeftIcon } from "lucide-react";
import type { WheelPreview } from "./quick-wheel-preview";
import styles from "./QuickWheelPreview.module.css";
import { cn } from "~/lib/utils";
import {
  quickWheelLayout,
  curvedChoiceAt,
  wheelDeadZoneRadius,
  WHEEL_CHOICE_DIAMETER,
  wheelChoiceRingRadius,
  wheelVisibleLimit,
  wheelHubRadius,
  type WheelBounds,
  type WheelLayout,
} from "./quick-wheel-layout";

import {
  type WheelArc,
  joystickWheelArc,
  wheelCarousel,
  wheelJoystickAxes,
  wheelJoystickMotion,
  wrapWheelIndex,
} from "./quick-wheel-joystick";

import {
  inwardSlots,
  wheelUsageId,
  type WheelUsage,
} from "./quick-wheel-usage";

type Choice = {
  label: string;
  select: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  dismiss?: boolean;
};
type Choices = { title: string; options: Choice[] };
/** Mutable gesture registry; methods keep it separate from React render state. */
class Registry {
  current: Choices | null = null;
  private changed?: (choices: Choices) => void;
  register(choices: Choices) {
    this.current = choices;
    this.changed?.(choices);
    return () => {
      if (this.current === choices) this.current = null;
    };
  }
  subscribe(listener: (choices: Choices) => void) {
    this.changed = listener;
    return () => {
      this.changed = undefined;
    };
  }
}
const WheelContext = createContext<Registry | null>(null);

/** Each stage supplies the same actions used by its cards, including off-page choices. */
export function useQuickWheelOptions(title: string, options: Choice[]) {
  const registry = useContext(WheelContext);
  useLayoutEffect(() => {
    if (!registry) return;
    const value = { title, options };
    return registry.register(value);
  }, [registry, title, options]);
  // Keep card and wheel selection actions consistent; selections do not affect ranking.
  return (label: string, commit?: () => void) => {
    const choice = options.find((option) => option.label === label);
    if (!choice) return;
    (commit ?? choice.select)();
  };
}

type Wheel = Choices & {
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  radius: number;
  bounds: WheelBounds;
  overlayTop: number;
  screenCentre: { x: number; y: number };
  usage: WheelUsage;
  hand?: WheelHand;
  offset: number;
  scrolling: number;
  repositioning?: boolean;
  hovered: number | null;
  moved: boolean;
  skipEntrance?: boolean;
  latched?: boolean;
};
type Entry = Choice & { sourceIndex: number };
// Layout search is relatively expensive. Cache it for a fixed origin rather
// than repeating the hand-aware geometry on every animation frame.
const geometryCache = new WeakMap<
  WheelBounds,
  Map<string, ReturnType<typeof createGeometry>>
>();
function createGeometry(wheel: Wheel): {
  layout: WheelLayout;
  points: { x: number; y: number }[];
  arc?: WheelArc;
} {
  const limit = wheelVisibleLimit(wheel.bounds, wheel.hand, wheel);
  const count = wheel.options.length;
  const capacity = Math.min(limit, count);
  if (wheel.hand) {
    const rail = joystickWheelArc(
      wheel,
      wheel.bounds,
      wheel.radius,
      count,
      wheel.hand,
      wheel.screenCentre,
    );
    if (rail)
      return {
        layout: {
          kind: "curved" as const,
          choices: rail.points.map((label) => ({
            label,
            polygon: [],
            path: "",
          })),
          deadZoneRadius: wheelHubRadius(wheel.radius),
          labelsOnly: true,
        },
        points: rail.points,
        arc: rail.arc,
      };
  }
  const layout = quickWheelLayout(
    wheel.x,
    wheel.y,
    wheel.radius,
    capacity,
    wheel.bounds,
    wheel.hand,
  );
  const points =
    layout.kind === "curved"
      ? layout.choices.map((choice) => choice.label)
      : Array.from({ length: capacity }, (_, index) => ({
          x:
            wheel.x +
            Math.sin((index * Math.PI * 2) / capacity) *
              wheelChoiceRingRadius(wheel.radius),
          y:
            wheel.y -
            Math.cos((index * Math.PI * 2) / capacity) *
              wheelChoiceRingRadius(wheel.radius),
        }));
  return { layout, points, arc: undefined };
}
function geometryFor(wheel: Wheel) {
  let cache = geometryCache.get(wheel.bounds);
  if (!cache) {
    cache = new Map();
    geometryCache.set(wheel.bounds, cache);
  }
  const key = `${wheel.x}:${wheel.y}:${wheel.radius}:${wheel.hand}:${wheel.options.length}`;
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = createGeometry(wheel);
    if (cache.size >= 8) cache.clear();
    cache.set(key, geometry);
  }
  return geometry;
}
/** Translate the whole rail while it fits; reflow only when reaching an edge. */
function moveWheelOrigin(wheel: Wheel, x: number, y: number): Wheel {
  const next = {
    ...wheel,
    x,
    y,
    startX: x,
    startY: y,
    hovered: null,
    moved: false,
    scrolling: 0,
    repositioning: true,
    skipEntrance: true,
  };
  const entries = entriesFor(wheel);
  const previous = geometryFor(wheel);
  const shift = (point: { x: number; y: number }) => ({
    x: point.x + x - wheel.x,
    y: point.y + y - wheel.y,
  });
  const points = previous.points.map(shift);
  const padding = WHEEL_CHOICE_DIAMETER / 2;
  if (
    points.every(
      (point) =>
        point.x - padding >= wheel.bounds.left &&
        point.x + padding <= wheel.bounds.right &&
        point.y - padding >= wheel.bounds.top + 52 &&
        point.y + padding <= wheel.bounds.bottom,
    )
  ) {
    const layout: WheelLayout =
      previous.layout.kind === "circle"
        ? previous.layout
        : {
            ...previous.layout,
            track: undefined,
            choices: previous.layout.choices.map((choice) => ({
              ...choice,
              label: shift(choice.label),
              polygon: choice.polygon.map(shift),
            })),
          };
    const cache = geometryCache.get(wheel.bounds)!;
    if (cache.size >= 8) cache.clear();
    cache.set(
      `${x}:${y}:${wheel.radius}:${wheel.hand}:${wheel.options.length}`,
      { ...previous, layout, points },
    );
  }
  entryCache.set(next.options, {
    geometry: geometryFor(next),
    usage: next.usage,
    title: next.title,
    entries,
  });
  return next;
}
const entryCache = new WeakMap<
  Choice[],
  {
    geometry: ReturnType<typeof createGeometry>;
    usage: WheelUsage;
    title: string;
    entries: Entry[];
  }
>();
function entriesFor(wheel: Wheel): Entry[] {
  const geometry = geometryFor(wheel);
  const cached = entryCache.get(wheel.options);
  if (
    cached?.geometry === geometry &&
    cached.usage === wheel.usage &&
    cached.title === wheel.title
  )
    return cached.entries;
  const ranked = wheel.options.map((choice, sourceIndex) => ({
    ...choice,
    sourceIndex,
  }));
  const frequency = (entry: Entry) =>
    wheel.usage[wheelUsageId(wheel.title, entry.label)] ?? 0;
  ranked.sort(
    (a, b) => frequency(b) - frequency(a) || a.sourceIndex - b.sourceIndex,
  );
  const entries = [...ranked];
  if (ranked.some((entry) => frequency(entry) > 0)) {
    const slots = inwardSlots(geometry.points, wheel.screenCentre);
    ranked.slice(0, slots.length).forEach((entry, index) => {
      entries[slots[index]!] = entry;
    });
  }
  entryCache.set(wheel.options, {
    geometry,
    usage: wheel.usage,
    title: wheel.title,
    entries,
  });
  return entries;
}
function tilesFor(wheel: Wheel) {
  const { layout, points, arc } = geometryFor(wheel);
  const entries = entriesFor(wheel);
  return wheelCarousel(
    wheel.offset,
    entries.length,
    points,
    wheel,
    layout.kind === "circle",
    arc,
  ).map((tile) => ({ ...tile, entry: entries[tile.index]! }));
}
export function wheelSector(
  dx: number,
  dy: number,
  count: number,
  radius: number,
) {
  const distance = Math.hypot(dx, dy);
  if (
    !count ||
    distance <= wheelDeadZoneRadius(radius) ||
    distance > radius * 1.65
  )
    return null;
  const angle =
    (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  return (
    Math.floor((angle + Math.PI / count) / ((Math.PI * 2) / count)) % count
  );
}
const interactive =
  'button, a, input, select, textarea, [role="button"], [role="slider"], [role="spinbutton"], [contenteditable="true"], [data-quick-wheel-ignore]';

/** Page actions can unmount the wheel before its initiating finger is lifted. */
function guardRemainingLift(pointerId: number) {
  const cleanup = () => {
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("pointercancel", release, true);
    window.removeEventListener("touchend", touch, true);
    window.removeEventListener("click", click, true);
    window.removeEventListener("pointerdown", next, true);
    window.removeEventListener("blur", cleanup);
    clearTimeout(expiry);
  };
  const release = (event: PointerEvent) => {
    if (event.pointerId === pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const touch = (event: TouchEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const click = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
  };
  const next = (event: PointerEvent) => {
    if (event.isPrimary !== false) cleanup();
  };
  const expiry = setTimeout(cleanup, 5000);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  window.addEventListener("touchend", touch, { capture: true, passive: false });
  window.addEventListener("click", click, true);
  window.addEventListener("pointerdown", next, true);
  window.addEventListener("blur", cleanup);
}

/** Hold blank workspace and dwell to choose. Releasing only dismisses the wheel. */
export function QuickWheelSurface({
  children,
  enabled = true,
  usage = {},
  previewChoice,
  onBack,
  activation = "press",
  activationSelector,
  onActivate,
  onActiveChange,
  showBackBar = true,
  showBackdrop = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  enabled?: boolean;
  usage?: WheelUsage;
  onBack?: () => void;
  /** Drawing workspaces reserve touch long-press and desktop context-menu. */
  activation?: "press" | "context";
  activationSelector?: string;
  onActivate?: (event: PointerEvent | MouseEvent) => void;
  onActiveChange?: (active: boolean) => void;
  showBackBar?: boolean;
  showBackdrop?: boolean;
  previewChoice?: (
    title: string,
    label: string,
  ) => WheelPreview | undefined | Promise<WheelPreview | undefined>;
}) {
  const interaction = useRef({
    activation,
    activationSelector,
    onActivate,
    onActiveChange,
    showBackBar,
  });
  useLayoutEffect(() => {
    interaction.current = {
      activation,
      activationSelector,
      onActivate,
      onActiveChange,
      showBackBar,
    };
  });
  const backAction = useRef(onBack);
  useLayoutEffect(() => {
    backAction.current = onBack;
  }, [onBack]);
  const backTarget = useRef<HTMLButtonElement>(null);
  const backLatched = useRef(false);
  const [backHovered, setBackHovered] = useState(false);
  const preparePreview = useRef(previewChoice);
  useLayoutEffect(() => {
    preparePreview.current = previewChoice;
  }, [previewChoice]);
  const [preview, setPreview] = useState<PendingPreview | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewVersion = useRef(0);
  const previewShown = useRef(false);
  const orderUsage = useRef(usage);
  useLayoutEffect(() => {
    orderUsage.current = usage;
  }, [usage]);
  const registry = useMemo(() => new Registry(), []);
  const surface = useRef<HTMLDivElement>(null);
  const active = useRef<Wheel | null>(null);
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionLatch = useRef<number | null>(null);
  const animation = useRef<number | null>(null);
  const stopScrolling = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };
  const suppressClick = useRef(false);
  // The wheel may disappear before its initiating finger leaves the screen.
  const heldPointer = useRef<number | null>(null);
  const wheelEnabled = useRef(enabled);
  useLayoutEffect(() => {
    wheelEnabled.current = enabled;
  }, [enabled]);
  const pointerPosition = useRef({ x: 0, y: 0 });
  const update = (value: Wheel | null) => {
    active.current = value;
    setWheel(value);
  };
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    previewVersion.current += 1;
    previewShown.current = false;
    setPreview(null);
  };
  const close = () => {
    stopScrolling();
    const wasOpen = active.current !== null;
    const pointerId = active.current?.pointerId;
    if (
      pointerId !== undefined &&
      surface.current?.hasPointerCapture?.(pointerId)
    )
      surface.current.releasePointerCapture(pointerId);
    clearTimer();
    backLatched.current = false;
    setBackHovered(false);
    selectionLatch.current = null;
    update(null);
    if (wasOpen) interaction.current.onActiveChange?.(false);
  };

  useHeaderBackOverride(activation === "context" && wheel ? close : null, {
    priority: 120,
  });

  useLayoutEffect(() => {
    return registry.subscribe((choices) => {
      const current = active.current;
      if (!current) return;
      const changed =
        choices.title !== current.title ||
        JSON.stringify(
          choices.options.map((o) => [o.label, Boolean(o.disabled)]),
        ) !==
          JSON.stringify(
            current.options.map((o) => [o.label, Boolean(o.disabled)]),
          );
      if (changed) {
        stopScrolling();
        clearTimer();
        // Leave the selected direction before arming another choice.
        selectionLatch.current = current.hovered;
        update({
          ...current,
          ...choices,
          usage: orderUsage.current,
          offset: 0,
          scrolling: 0,
          repositioning: false,
          hovered: null,
        });
      } else {
        active.current = { ...current, options: choices.options };
      }
    });
  }, [registry]);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    let pending: {
      event: PointerEvent;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    const clearPending = () => {
      if (pending) clearTimeout(pending.timer);
      pending = null;
    };
    const eligible = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const control = target.closest(interactive);
      // Annotation SVGs are accessible buttons, but remain part of the drawing.
      if (
        control &&
        !(
          interaction.current.activation === "context" &&
          control.hasAttribute("data-annotation-id")
        )
      )
        return false;
      return (
        !interaction.current.activationSelector ||
        Boolean(target.closest(interaction.current.activationSelector))
      );
    };
    function open(event: PointerEvent | MouseEvent, latched = false) {
      if (!wheelEnabled.current) return;
      if (
        !latched &&
        event instanceof PointerEvent &&
        event.isPrimary === false
      )
        return;
      const choices = registry.current;
      if (!choices?.options.length) return;
      const bounds = element!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const left = Math.max(viewportLeft + 12, bounds.left + 8),
        right = Math.min(
          viewportLeft + (viewport?.width ?? innerWidth) - 12,
          bounds.right - 8,
        );
      const top = Math.max(viewportTop + 12, bounds.top + 8),
        bottom = Math.min(
          viewportTop +
            (viewport?.height ?? innerHeight) -
            (interaction.current.showBackBar ? 88 : 12),
          bounds.bottom - 8,
        );
      const radius = Math.min(170, (right - left) / 2, (bottom - top) / 2);
      if (radius < 95) return;
      event.preventDefault();
      interaction.current.onActivate?.(event);
      // Stage cards/headings are replaced when entering Parts. Keep the
      // gesture owned by this stable surface, not the removed touch target.
      const pointerId = "pointerId" in event ? event.pointerId : -1;
      if (!latched) element!.setPointerCapture?.(pointerId);
      suppressClick.current = true;
      heldPointer.current = latched ? null : pointerId;
      pointerPosition.current = { x: event.clientX, y: event.clientY };
      selectionLatch.current = null;
      update({
        ...choices,
        hand:
          "pointerType" in event && event.pointerType === "touch"
            ? learnWheelHand(
                event.clientX,
                viewportLeft,
                viewport?.width ?? innerWidth,
              )
            : undefined,
        pointerId,
        latched,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        radius,
        bounds: { left, top, right, bottom },
        overlayTop: Math.max(viewportTop, bounds.top),
        screenCentre: {
          x: viewportLeft + (viewport?.width ?? innerWidth) / 2,
          y: viewportTop + (viewport?.height ?? innerHeight) / 2,
        },
        usage: orderUsage.current,
        offset: 0,
        scrolling: 0,
        hovered: null,
        moved: false,
      });
      interaction.current.onActiveChange?.(true);
    }
    function start(event: PointerEvent) {
      if (!wheelEnabled.current) return;
      if (active.current) {
        if (active.current.latched) {
          if (event.button !== 0) return;
          heldPointer.current = event.pointerId;
          suppressClick.current = true;
          event.preventDefault();
          event.stopImmediatePropagation();
          close();
        } else if (event.pointerId !== active.current.pointerId) close();
        return;
      }
      clearPending();
      if (
        event.button !== 0 ||
        event.isPrimary === false ||
        !eligible(event.target)
      )
        return;
      if (interaction.current.activation === "context") {
        if (event.pointerType !== "touch") return;
        pending = {
          event,
          timer: setTimeout(() => {
            pending = null;
            open(event);
          }, 500),
        };
      } else open(event);
    }
    function scroll(speed: number) {
      const current = active.current;
      if (!current) return;
      if (!speed) {
        stopScrolling();
        if (current.scrolling) update({ ...current, scrolling: 0 });
        return;
      }
      clearTimer();
      selectionLatch.current = null;
      update({
        ...current,
        scrolling: speed,
        hovered: null,
        skipEntrance: true,
      });
      if (animation.current !== null) return;
      let last = performance.now();
      const tick = (now: number) => {
        const live = active.current;
        if (!live || !live.scrolling) {
          animation.current = null;
          return;
        }
        // No catch-up jump after a stalled frame. Right deflection moves tiles
        // clockwise/right, and left reverses, without momentum after release.
        const dt = Math.min(50, Math.max(0, now - last)) / 1000;
        last = now;
        update({
          ...live,
          offset: wrapWheelIndex(
            live.offset - live.scrolling * dt,
            geometryFor(live).arc &&
              live.options.length <= geometryFor(live).points.length
              ? live.options.length + 1
              : live.options.length,
          ),
        });
        animation.current = requestAnimationFrame(tick);
      };
      animation.current = requestAnimationFrame(tick);
    }
    function move(event: PointerEvent) {
      if (
        pending &&
        (event.pointerId !== pending.event.pointerId ||
          Math.hypot(
            event.clientX - pending.event.clientX,
            event.clientY - pending.event.clientY,
          ) > 8)
      )
        clearPending();
      let current = active.current;
      if (
        !current ||
        (!current.latched && event.pointerId !== current.pointerId)
      )
        return;
      event.preventDefault();
      if (interaction.current.activation === "context")
        event.stopImmediatePropagation();
      pointerPosition.current = { x: event.clientX, y: event.clientY };
      const backBounds =
        backAction.current || backLatched.current
          ? backTarget.current?.getBoundingClientRect()
          : undefined;
      const overBack =
        backBounds &&
        event.clientX >= backBounds.left &&
        event.clientX <= backBounds.right &&
        event.clientY >= backBounds.top &&
        event.clientY <= backBounds.bottom;
      if (overBack) {
        scroll(0);
        current = active.current!;
        clearTimer();
        setBackHovered(true);
        if (!backLatched.current) {
          backLatched.current = true;
          selectionLatch.current = null;
          update({ ...current, hovered: null, moved: false });
          backAction.current?.();
        }
        return;
      }
      backLatched.current = false;
      setBackHovered(false);
      const moved =
        current.moved ||
        Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY,
        ) > 12;
      const dx = event.clientX - current.x,
        dy = event.clientY - current.y;
      const inHub = Math.hypot(dx, dy) <= wheelHubRadius(current.radius);
      const motion = wheelJoystickMotion(
        current,
        pointerPosition.current,
        current.screenCentre,
        current.radius,
        current.repositioning,
      );
      if (motion.relocate) {
        stopScrolling();
        clearTimer();
        selectionLatch.current = null;
        update(
          moveWheelOrigin(
            current,
            Math.max(
              current.bounds.left,
              Math.min(current.bounds.right, event.clientX),
            ),
            Math.max(
              current.bounds.top,
              Math.min(current.bounds.bottom, event.clientY),
            ),
          ),
        );
        return;
      }
      if (current.repositioning) {
        current = { ...current, repositioning: false };
        update(current);
      }
      const speed = current.options.length > 1 ? motion.speed : 0;
      scroll(speed);
      current = active.current!;
      if (speed) return;
      const { layout, points } = geometryFor(current);
      const entries = entriesFor(current);
      let hovered: number | null = null;
      if (moved && !inHub) {
        const tiles = tilesFor(current);
        const target = tiles
          .filter((tile) => tile.opacity >= 0.65 && !tile.entry.disabled)
          .sort(
            (a, b) =>
              Math.hypot(a.x - event.clientX, a.y - event.clientY) -
              Math.hypot(b.x - event.clientX, b.y - event.clientY),
          )
          .find(
            (tile) =>
              Math.hypot(tile.x - event.clientX, tile.y - event.clientY) <=
              WHEEL_CHOICE_DIAMETER / 2 + 6,
          );
        hovered = target?.entry.sourceIndex ?? null;
        // Preserve the original forgiving wedges before scrolling begins.
        if (hovered === null && current.offset === 0) {
          const slot =
            layout.kind === "curved"
              ? curvedChoiceAt(
                  layout,
                  event.clientX,
                  event.clientY,
                  current.x,
                  current.y,
                )
              : wheelSector(dx, dy, points.length, current.radius);
          if (slot !== null && !entries[slot]?.disabled)
            hovered = entries[slot]?.sourceIndex ?? null;
        }
      }
      if (hovered === current.hovered && moved === current.moved) {
        // The visual next centre matches where a confirmed choice will recenter.
        setPreview((value) =>
          value ? { ...value, x: event.clientX, y: event.clientY } : null,
        );
        return;
      }
      clearTimer();
      if (hovered !== selectionLatch.current) selectionLatch.current = null;
      const next = { ...current, hovered, moved };
      update(next);
      const entry =
        hovered === null
          ? null
          : entriesFor(next).find((entry) => entry.sourceIndex === hovered);
      if (entry && selectionLatch.current === null) {
        const version = previewVersion.current;
        const deadline = Date.now() + 500;
        if (preparePreview.current) {
          previewTimer.current = setTimeout(() => {
            previewTimer.current = null;
            void Promise.resolve()
              .then(() => preparePreview.current?.(next.title, entry.label))
              .then((value) => {
                if (
                  !value ||
                  previewVersion.current !== version ||
                  !active.current ||
                  Date.now() >= deadline
                )
                  return;
                const { x, y } = pointerPosition.current;
                previewShown.current = true;
                setPreview({
                  value,
                  x,
                  y,
                  duration: deadline - Date.now(),
                  key: version,
                  label: entry.label,
                });
              })
              .catch(() => {
                /* Speculation may fail; the real selection still works. */
              });
          }, 50);
        }
        timer.current = setTimeout(() => {
          timer.current = null;
          const hadPreview = previewShown.current;
          clearTimer();
          const current = active.current;
          if (
            !current ||
            current.hovered !== hovered ||
            current.offset !== next.offset ||
            current.title !== next.title
          )
            return;
          // Start the next choice directly under the finger, even when it
          // moved within the same sector during the dwell timer.
          const { x, y } = pointerPosition.current;
          selectionLatch.current = null;
          update({
            ...current,
            x,
            y,
            startX: x,
            startY: y,
            scrolling: 0,
            repositioning: false,
            skipEntrance: hadPreview,
            hovered: null,
            moved: false,
          });
          // Use the latest callbacks after query or pending-quantity changes.
          const choice = registry.current?.options[entry.sourceIndex];
          if (choice && !choice.disabled) {
            choice.select();
            if (choice.dismiss) close();
          }
        }, 500);
      }
    }
    function end(event: PointerEvent) {
      if (pending?.event.pointerId === event.pointerId) clearPending();
      if (event.pointerId !== heldPointer.current) return;
      heldPointer.current = null;
      close();
      event.preventDefault();
      // Capture phase: newly mounted part cards must never receive this lift.
      event.stopImmediatePropagation();
    }

    function finishTouch(event: TouchEvent) {
      if (!suppressClick.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function cancel() {
      clearPending();
      close();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    }
    function touch(event: TouchEvent) {
      if (event.touches.length > 1) {
        close();
        return;
      }
      if (active.current) event.preventDefault();
    }
    function click(event: MouseEvent) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
    function resetClick(event: PointerEvent) {
      if (event.isPrimary !== false) {
        heldPointer.current = null;
        suppressClick.current = false;
      }
    }
    function context(event: MouseEvent) {
      if (
        interaction.current.activation === "context" &&
        wheelEnabled.current &&
        eligible(event.target)
      ) {
        const touchPress = pending?.event;
        clearPending();
        event.preventDefault();
        event.stopImmediatePropagation();
        if (touchPress) {
          open(touchPress);
          return;
        }
        // Android may emit a context-menu while its initiating touch is held.
        if (
          (event as PointerEvent).pointerType === "touch" ||
          heldPointer.current !== null
        )
          return;
        if (active.current) close();
        else open(event, true);
      } else if (active.current) event.preventDefault();
    }
    element.addEventListener("pointerdown", start, true);
    window.addEventListener("pointerdown", resetClick, true);
    window.addEventListener("pointermove", move, {
      passive: false,
      capture: true,
    });
    window.addEventListener("pointerup", end, true);
    window.addEventListener("touchend", finishTouch, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.visualViewport?.addEventListener("resize", cancel);
    window.visualViewport?.addEventListener("scroll", cancel);
    window.addEventListener("keydown", key, true);
    document.addEventListener("visibilitychange", cancel);
    element.addEventListener("touchstart", touch, { passive: false });
    window.addEventListener("touchmove", touch, { passive: false });
    element.addEventListener("click", click, true);
    element.addEventListener("contextmenu", context, true);
    return () => {
      if (
        heldPointer.current !== null &&
        interaction.current.activation === "context"
      )
        guardRemainingLift(heldPointer.current);
      clearPending();
      stopScrolling();
      clearTimer();
      const pointerId = active.current?.pointerId;
      if (pointerId !== undefined && element.hasPointerCapture?.(pointerId))
        element.releasePointerCapture(pointerId);
      active.current = null;
      element.removeEventListener("pointerdown", start, true);
      window.removeEventListener("pointerdown", resetClick, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("touchend", finishTouch, true);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.visualViewport?.removeEventListener("resize", cancel);
      window.visualViewport?.removeEventListener("scroll", cancel);
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("visibilitychange", cancel);
      element.removeEventListener("touchstart", touch);
      window.removeEventListener("touchmove", touch);
      element.removeEventListener("click", click, true);
      element.removeEventListener("contextmenu", context, true);
    };
  }, []); // Keep release/click guards alive when the final choice disables the wheel.

  useEffect(() => {
    if (!enabled) close();
  }, [enabled]);

  return (
    <WheelContext.Provider value={registry}>
      <div {...props} ref={surface}>
        {children}
        {wheel && (
          <>
            <WheelDisplay
              wheel={wheel}
              preview={preview}
              showBackdrop={showBackdrop}
            />
            {showBackBar && (
              <button
                ref={backTarget}
                type="button"
                data-quick-wheel-back=""
                data-active={backHovered}
                aria-label="Back one step"
                disabled={!onBack}
                onClick={() => backAction.current?.()}
                className={cn(
                  "pointer-events-none fixed inset-x-0 bottom-0 z-[101] flex h-[calc(4rem+env(safe-area-inset-bottom))] items-center justify-center gap-2 border-t pb-[env(safe-area-inset-bottom)] text-base font-semibold shadow-lg transition-colors",
                  backHovered && onBack
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-card-foreground",
                  !onBack && "text-muted-foreground",
                )}
              >
                <ArrowLeftIcon className="size-5" /> Back
              </button>
            )}
          </>
        )}
      </div>
    </WheelContext.Provider>
  );
}

type PendingPreview = {
  value: WheelPreview;
  x: number;
  y: number;
  duration: number;
  key: number;
  label: string;
};
function WheelDisplay({
  wheel,
  preview,
  isPreview = false,
  pendingLabel,
  duration,
  showBackdrop = true,
}: {
  wheel: Wheel;
  preview?: PendingPreview | null;
  isPreview?: boolean;
  pendingLabel?: string;
  duration?: number;
  showBackdrop?: boolean;
}) {
  const tiles = tilesFor(wheel);
  const selected = tiles.find(
    (tile) => tile.entry.sourceIndex === wheel.hovered,
  );
  const { layout, points } = geometryFor(wheel);
  const hub = wheelHubRadius(wheel.radius);
  const axes = wheelJoystickAxes(wheel, wheel.screenCentre);
  const hint = selected
    ? "Hold to select"
    : wheel.scrolling
      ? "Aim inward to stop"
      : "Slide sideways";
  const tileClass = (entry: Entry) =>
    cn(
      "quick-wheel-tile flex h-full w-full items-center justify-center rounded-full border p-1.5 text-center text-[13px] leading-tight font-semibold tracking-wide uppercase shadow-[0_6px_16px_-4px_rgb(0_0_0/0.25)] transition-[scale,background-color,color,box-shadow,border-color] duration-150 ease-out",
      entry.disabled && "opacity-40",
      wheel.hovered === entry.sourceIndex
        ? "bg-primary text-primary-foreground border-primary ring-primary/25 scale-110 shadow-lg ring-4"
        : "bg-card text-card-foreground border-primary/25 dark:border-primary/35",
    );
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-[100] select-none",
        isPreview && styles.preview,
      )}
      data-quick-wheel={isPreview ? undefined : ""}
      data-wheel-preview={isPreview ? "" : undefined}
      aria-hidden={isPreview || undefined}
      style={
        isPreview
          ? ({
              "--preview-duration": `${duration ?? 450}ms`,
            } as React.CSSProperties)
          : undefined
      }
      data-layout={layout.kind}
      data-hand={wheel.hand}
      data-offset={wheel.offset}
      data-scrolling={Boolean(wheel.scrolling)}
      data-origin-x={wheel.x}
      data-origin-y={wheel.y}
      aria-label={`${wheel.title} quick wheel`}
      role={isPreview ? undefined : "status"}
      aria-live={isPreview || wheel.scrolling ? "off" : "polite"}
    >
      {!isPreview && showBackdrop && (
        <div
          className="quick-wheel-backdrop bg-background/75 absolute inset-x-0 bottom-0 backdrop-blur-md"
          style={{ top: wheel.overlayTop }}
        />
      )}
      <div
        className={preview ? styles.current : undefined}
        style={
          preview
            ? ({
                "--preview-duration": `${preview.duration}ms`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <div
          className="absolute text-center"
          style={{
            // Over the round wheel; across the screen for the edge layout.
            left: layout.kind === "circle" ? wheel.x - 160 : 0,
            width: layout.kind === "circle" ? 320 : "100%",
            top:
              layout.kind === "circle"
                ? wheel.y - wheel.radius - 76 >= wheel.bounds.top
                  ? wheel.y - wheel.radius - 76
                  : wheel.y + wheel.radius + 22
                : wheel.bounds.top + 4,
          }}
        >
          <p className="text-foreground text-lg font-semibold">
            {isPreview ? `Next: ${wheel.title}` : wheel.title}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {isPreview
              ? `Preview · keep holding ${pendingLabel ?? "your choice"}`
              : "Slide sideways to scroll · pull away to move"}
          </p>
        </div>
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
          {layout.kind === "circle" ? (
            <circle
              cx={wheel.x}
              cy={wheel.y}
              r={wheelChoiceRingRadius(wheel.radius)}
              fill="none"
              className="stroke-primary/30"
              strokeWidth="2"
            />
          ) : (
            <path
              data-wheel-track=""
              d={layout.track ?? smoothCurve(points)}
              fill="none"
              className="stroke-primary/30 dark:stroke-primary/40"
              strokeWidth="3"
              strokeLinecap="round"
            />
          )}
          {tiles.map(({ key, x, y, opacity, entry }, index) => (
            <foreignObject
              key={`${wheel.title}:${key}`}
              data-wheel-choice={index}
              data-source-index={entry.sourceIndex}
              x={x - WHEEL_CHOICE_DIAMETER / 2}
              y={y - WHEEL_CHOICE_DIAMETER / 2}
              width={WHEEL_CHOICE_DIAMETER}
              height={WHEEL_CHOICE_DIAMETER}
              className="overflow-visible"
              opacity={opacity}
            >
              <div
                className={tileClass(entry)}
                style={{
                  ...({
                    "--from-x": `${wheel.x - x}px`,
                    "--from-y": `${wheel.y - y}px`,
                  } as React.CSSProperties),
                  animationDelay: `${index * 25}ms`,
                  animationName:
                    isPreview || wheel.skipEntrance || wheel.offset !== 0
                      ? "none"
                      : undefined,
                }}
              >
                <span
                  className={
                    entry.icon
                      ? "flex flex-col items-center gap-1 px-1 text-xs [&_svg]:size-5"
                      : "whitespace-nowrap"
                  }
                >
                  {entry.icon}
                  {entry.label}
                </span>
              </div>
            </foreignObject>
          ))}
          {/* Painted last: options disappear underneath the thumb, not over it. */}
          <circle
            data-wheel-hub=""
            cx={wheel.x}
            cy={wheel.y}
            r={hub}
            className="fill-card stroke-border drop-shadow-lg"
            strokeWidth="1.5"
          />
          <HighlightArc
            cx={wheel.x}
            cy={wheel.y}
            radius={hub + 12}
            angle={
              selected
                ? Math.atan2(selected.x - wheel.x, wheel.y - selected.y)
                : null
            }
          />
          <circle
            data-wheel-stick=""
            cx={
              wheel.x +
              axes.inward.x * (hub - 14) +
              axes.sideways.x *
                (wheel.scrolling ? Math.sign(wheel.scrolling) * 12 : 0)
            }
            cy={
              wheel.y +
              axes.inward.y * (hub - 14) +
              axes.sideways.y *
                (wheel.scrolling ? Math.sign(wheel.scrolling) * 12 : 0)
            }
            r="4"
            className="fill-primary"
          />
        </svg>
        <div
          className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center"
          style={{ left: wheel.x, top: wheel.y - 8, width: hub * 1.65 }}
        >
          <span
            className={cn(
              "line-clamp-2 text-sm leading-tight font-semibold uppercase",
              selected ? "text-primary" : "text-foreground",
            )}
          >
            {selected?.entry.label ?? wheel.title}
          </span>
          <span className="text-muted-foreground text-[10px] leading-tight">
            {hint}
          </span>
        </div>
      </div>
      {preview &&
        (preview.value.kind === "wheel" && preview.value.options.length ? (
          <WheelDisplay
            key={preview.key}
            isPreview
            duration={preview.duration}
            pendingLabel={preview.label}
            wheel={{
              ...wheel,
              title: preview.value.title,
              options: preview.value.options.map((option) => ({
                label: option.label,
                icon: option.icon,
                disabled: option.disabled,
                select: () => undefined,
              })),
              x: preview.x,
              y: preview.y,
              offset: 0,
              scrolling: 0,
              hovered: null,
              moved: false,
            }}
          />
        ) : preview.value.kind === "parts" ? (
          <div
            key={preview.key}
            data-wheel-preview="parts"
            aria-hidden="true"
            className={cn(
              styles.preview,
              "bg-card absolute inset-x-3 bottom-6 mx-auto max-w-3xl rounded-2xl border p-3 shadow-lg",
            )}
            style={
              {
                "--preview-duration": `${preview.duration}ms`,
                top: Math.max(wheel.bounds.top + 8, wheel.overlayTop + 8),
                bottom: "auto",
              } as React.CSSProperties
            }
          >
            <p className="text-sm font-semibold">Next: Parts</p>
            <p className="text-muted-foreground mb-2 text-xs">
              Preview · keep holding {preview.label}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {preview.value.options.map((option, index) => (
                <div
                  key={index}
                  className="min-w-0 rounded-lg border p-2 text-center"
                >
                  {option.imageUrl && (
                    <div className="relative mb-1 aspect-square">
                      <Image
                        src={option.imageUrl}
                        alt=""
                        fill
                        className="object-contain"
                      />
                    </div>
                  )}
                  <span className="line-clamp-3 text-xs">{option.label}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null)}
    </div>
  );
}

/** A smooth track through the tile centres (Catmull-Rom as cubic Béziers). */
function smoothCurve(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";
  let d = `M${points[0]!.x} ${points[0]!.y}`;
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index - 1] ?? points[index]!,
      p1 = points[index]!,
      p2 = points[index + 1]!,
      p3 = points[index + 2] ?? p2;
    d += `C${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6} ${p2.x} ${p2.y}`;
  }
  return d;
}

/** A short arc just outside the hub that swings to point at the highlighted choice. */
function HighlightArc({
  cx,
  cy,
  radius,
  angle,
  strokeWidth = 6,
}: {
  cx: number;
  cy: number;
  radius: number;
  /** Clockwise from straight up, in radians; null hides the arc. */
  angle: number | null;
  strokeWidth?: number;
}) {
  const span = 0.9;
  const at = (a: number) =>
    `${cx + Math.sin(a) * radius} ${cy - Math.cos(a) * radius}`;
  return (
    <g
      className="text-primary"
      style={{
        transform: `rotate(${((angle ?? 0) * 180) / Math.PI}deg)`,
        transformOrigin: `${cx}px ${cy}px`,
        transition:
          "transform 220ms cubic-bezier(0.22, 1.2, 0.36, 1), opacity 150ms",
        opacity: angle === null ? 0 : 1,
      }}
    >
      <path
        d={`M${at(-span / 2)}A${radius} ${radius} 0 0 1 ${at(span / 2)}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </g>
  );
}
