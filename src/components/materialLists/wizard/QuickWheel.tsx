"use client";

import { useHeaderBackOverride } from "~/lib/header-back-events";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
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
  wheelCarouselPeriod,
  viewportWheelArc,
  wheelChoiceCone,
  wheelThumbAnchor,
  wheelJoystickAxes,
  wheelJoystickMotion,
  wheelRailAxes,
  wheelJoystickRadius,
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
  viewBounds: WheelBounds;
  overlayTop: number;
  screenCentre: { x: number; y: number };
  thumbAnchor: { x: number; y: number };
  usage: WheelUsage;
  hand?: WheelHand;
  offset: number;
  scrolling: number;
  repositioning?: boolean;
  /** Thumb neutral relative to the hub, where the hub was pushed in so the
   * scroll wings stay on screen. Scrolling and aiming measure from here. */
  grip?: { x: number; y: number };
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
      wheel.thumbAnchor,
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
        arc: viewportWheelArc(wheel, rail.arc, rail.points.length, wheel.viewBounds),
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
/** Scroll along the rail itself, which may turn away from the thumb anchor
 * where the viewport pushes it aside. */
const axesFor = (wheel: Wheel) =>
  wheelRailAxes(wheel, wheel.thumbAnchor, geometryFor(wheel).arc);
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
type WheelPoint = { x: number; y: number };
/** Where the thumb rests; the hub may sit beside it. */
const wheelNeutral = (wheel: Wheel): WheelPoint => ({
  x: wheel.x + (wheel.grip?.x ?? 0),
  y: wheel.y + (wheel.grip?.y ?? 0),
});
const hasScrollWings = (wheel: Wheel) =>
  Boolean(wheel.hand) && wheel.options.length > 1;
/** Wings run a little past the reach for full speed. */
const scrollWingLength = (radius: number) => wheelJoystickRadius(radius) * 1.2;
/** One wing as two cubic curves in rail coordinates: `out` along the scroll
 * axis from the hub, `up` toward the choices. */
function scrollWingOutline(hub: number, length: number): [number, number][] {
  return [
    [hub * 0.7, hub * 0.52],
    [hub * 1.05, hub * 0.58],
    [length - hub * 0.35, hub * 0.3],
    [length, 0],
    [length - hub * 0.4, -hub * 0.22],
    [hub * 1.05, -hub * 0.28],
    [hub * 0.7, -hub * 0.5],
  ];
}
/** Bend rail coordinates around the rail's centre, so the wings stay parallel
 * to the choices however the rail is turned. */
function scrollWingPoint(
  cx: number,
  cy: number,
  axes: ReturnType<typeof wheelRailAxes>,
  side: number,
  out: number,
  up: number,
): WheelPoint {
  const bent = Number.isFinite(axes.bend);
  const along = bent ? (axes.bend + up) * Math.sin(out / axes.bend) : out;
  const across = bent ? (axes.bend + up) * Math.cos(out / axes.bend) - axes.bend : up;
  return {
    x: cx + side * axes.sideways.x * along + axes.inward.x * across,
    y: cy + side * axes.sideways.y * along + axes.inward.y * across,
  };
}
/** Push the hub in from the edges until both wings are fully on screen. The
 * curves stay inside their control points, so those are enough to test. The
 * rail turns as the hub moves, so settle over a few passes. */
function fitScrollWings(
  place: (x: number, y: number) => Wheel,
  thumb: WheelPoint,
): Wheel {
  let wheel = place(thumb.x, thumb.y);
  if (hasScrollWings(wheel)) {
    const margin = 4;
    for (let pass = 0; pass < 4; pass++) {
      const axes = axesFor(wheel);
      const outline = scrollWingOutline(
        wheelHubRadius(wheel.radius),
        scrollWingLength(wheel.radius),
      );
      const { bounds } = wheel;
      let left = 0, right = 0, top = 0, bottom = 0;
      for (const side of [-1, 1])
        for (const [out, up] of outline) {
          const p = scrollWingPoint(wheel.x, wheel.y, axes, side, out, up);
          left = Math.max(left, bounds.left + margin - p.x);
          right = Math.max(right, p.x - bounds.right + margin);
          top = Math.max(top, bounds.top + margin - p.y);
          bottom = Math.max(bottom, p.y - bounds.bottom + margin);
        }
      const dx = Math.ceil(left) - Math.ceil(right);
      const dy = Math.ceil(top) - Math.ceil(bottom);
      if (!dx && !dy) break;
      wheel = place(
        Math.max(bounds.left, Math.min(bounds.right, wheel.x + dx)),
        Math.max(bounds.top, Math.min(bounds.bottom, wheel.y + dy)),
      );
    }
  }
  const grip = { x: thumb.x - wheel.x, y: thumb.y - wheel.y };
  return { ...wheel, grip: grip.x || grip.y ? grip : undefined };
}
/** Follow the thumb, keeping the scroll wings on screen. */
function moveWheelOrigin(wheel: Wheel, x: number, y: number): Wheel {
  return {
    ...fitScrollWings((hx, hy) => placeWheelOrigin(wheel, hx, hy), { x, y }),
    startX: x,
    startY: y,
  };
}
/** Translate the whole rail while it fits; reflow only when reaching an edge. */
function placeWheelOrigin(wheel: Wheel, x: number, y: number): Wheel {
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
  const inward = wheelJoystickAxes(next, next.thumbAnchor).inward;
  if (
    points.every(
      (point) =>
        (point.x - x) * inward.x + (point.y - y) * inward.y >= 0 &&
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
      { ...previous, layout, points, arc: previous.arc
        ? viewportWheelArc(next, previous.arc, points.length, wheel.viewBounds) : undefined },
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
  resetKey,
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
  /** Close an active gesture when its host changes viewing mode. */
  resetKey?: string | number | boolean;
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
  const relocation = useRef<{ armed: boolean; centreSince: number | null }>({
    armed: false, centreSince: null,
  });
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

  // Effects and window listeners close the wheel as it is now, not as it was when they started.
  const closeWheel = useEffectEvent(close);
  useEffect(() => { closeWheel(); }, [resetKey]);

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
      if (!(target instanceof Element) || target.closest("[data-quick-wheel-ignore]")) return false;
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
      relocation.current = { armed: true, centreSince: Date.now() };
      const hand =
        "pointerType" in event && event.pointerType === "touch"
          ? learnWheelHand(
              event.clientX,
              viewportLeft,
              viewport?.width ?? innerWidth,
            )
          : undefined;
      const anchorHand =
        hand ??
        (event.clientX < viewportLeft + (viewport?.width ?? innerWidth) / 2
          ? "left"
          : "right");
      const opened: Wheel = {
        ...choices,
        hand,
        thumbAnchor: wheelThumbAnchor(
          {
            left: viewportLeft,
            top: viewportTop,
            right: viewportLeft + (viewport?.width ?? innerWidth),
            bottom: viewportTop + (viewport?.height ?? innerHeight),
          },
          anchorHand,
        ),
        pointerId,
        latched,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        radius,
        bounds: { left, top, right, bottom },
        viewBounds: {
          left: Math.max(viewportLeft, bounds.left),
          top: Math.max(viewportTop, bounds.top),
          right: Math.min(viewportLeft + (viewport?.width ?? innerWidth), bounds.right),
          bottom: Math.min(viewportTop + (viewport?.height ?? innerHeight) - (interaction.current.showBackBar ? 88 : 0), bounds.bottom),
        },
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
      };
      update(
        fitScrollWings((x, y) => ({ ...opened, x, y }), {
          x: event.clientX,
          y: event.clientY,
        }),
      );
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
          closeWheel();
        } else if (event.pointerId !== active.current.pointerId) closeWheel();
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
          }, 700),
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
            wheelCarouselPeriod(live.options.length, geometryFor(live).points.length, geometryFor(live).arc),
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
      const neutral = wheelNeutral(current);
      const dx = event.clientX - neutral.x,
        dy = event.clientY - neutral.y;
      const selectionRadius = wheelHubRadius(current.radius) * 0.75;
      const inHub = Math.hypot(dx, dy) <= selectionRadius;
      const axes = axesFor(current);
      const { inward, sideways } = axes;
      const forward = dx * inward.x + dy * inward.y;
      const lateral = dx * sideways.x + dy * sideways.y;
      if (!current.repositioning) {
        const intent = relocation.current;
        const now = Date.now();
        // Crossing the hub while reversing scroll direction must not arm a
        // move. Pause in its centre, then pull straight away from the arc.
        if (Math.hypot(dx, dy) <= 18) {
          intent.centreSince ??= now;
        }
        if (intent.centreSince !== null && now - intent.centreSince >= 250)
          intent.armed = true;
        if (Math.hypot(dx, dy) > 18) {
          intent.centreSince = null;
          if (forward >= 0 || Math.abs(lateral) > -forward * Math.tan(Math.PI / 9))
            intent.armed = false;
        }
      }
      const motion = wheelJoystickMotion(
        neutral,
        pointerPosition.current,
        current.thumbAnchor,
        current.radius,
        current.repositioning,
        relocation.current.armed,
        axes,
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
        relocation.current = { armed: false, centreSince: null };
        current = { ...current, repositioning: false };
        update(current);
      }
      const tiles = tilesFor(current).filter(
        (tile) => tile.opacity >= 0.65 && !tile.entry.disabled,
      );
      const movingInward = dx * inward.x + dy * inward.y > Math.hypot(dx, dy) * 0.25;
      // Inward selection starts inside the visible hub, before the full
      // joystick reach. Keep full reach sideways so scrolling remains available.
      // Continuing sideways keeps the scrolling gesture even beyond joystick
      // reach. Turning inward hands control back to the visible choice lanes.
      const extendingScroll = Boolean(current.hand && current.scrolling) && !movingInward && motion.speed !== 0;
      const target = !extendingScroll && !inHub && moved
        ? wheelChoiceCone(neutral, pointerPosition.current, current.radius, tiles,
            movingInward ? selectionRadius : undefined)
          ?? tiles
            .sort((a, b) =>
              Math.hypot(a.x - event.clientX, a.y - event.clientY) -
              Math.hypot(b.x - event.clientX, b.y - event.clientY))
            .find((tile) =>
              Math.hypot(tile.x - event.clientX, tile.y - event.clientY) <=
              WHEEL_CHOICE_DIAMETER / 2 + 6)
        : undefined;
      // Freeze rotation along visible selection lanes even before the thumb
      // clears the joystick. Otherwise the target moves away on approach.
      const approachingChoice = movingInward && wheelChoiceCone(
        neutral, pointerPosition.current, current.radius, tiles, 24,
      );
      const speed = current.options.length > 1 && !target && !approachingChoice
        ? motion.speed : 0;
      scroll(speed);
      current = active.current!;
      if (speed) return;
      const hovered = target?.entry.sourceIndex ?? null;
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
        const deadline = Date.now() + 700;
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
          relocation.current = { armed: true, centreSince: Date.now() };
          update(
            fitScrollWings(
              (hx, hy) => ({
                ...current,
                x: hx,
                y: hy,
                startX: x,
                startY: y,
                scrolling: 0,
                repositioning: false,
                skipEntrance: hadPreview,
                hovered: null,
                moved: false,
              }),
              { x, y },
            ),
          );
          // Use the latest callbacks after query or pending-quantity changes.
          const choice = registry.current?.options[entry.sourceIndex];
          if (choice && !choice.disabled) {
            choice.select();
            if (choice.dismiss) closeWheel();
          }
        }, 700);
      }
    }
    function end(event: PointerEvent) {
      if (pending?.event.pointerId === event.pointerId) clearPending();
      if (event.pointerId !== heldPointer.current) return;
      heldPointer.current = null;
      closeWheel();
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
      closeWheel();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        event.stopPropagation();
        closeWheel();
      }
    }
    function touch(event: TouchEvent) {
      if (event.touches.length > 1) {
        closeWheel();
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
        if (active.current) closeWheel();
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
  }, [registry]); // Keep release/click guards alive when the final choice disables the wheel.

  useEffect(() => {
    if (!enabled) closeWheel();
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
  const axes = axesFor(wheel);
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
      data-anchor-x={wheel.thumbAnchor.x}
      data-anchor-y={wheel.thumbAnchor.y}
      data-thumb-x={wheelNeutral(wheel).x}
      data-thumb-y={wheelNeutral(wheel).y}
      data-inward-x={axes.inward.x.toFixed(4)}
      data-inward-y={axes.inward.y.toFixed(4)}
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
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true"
          style={{ clipPath: `inset(${wheel.viewBounds.top}px calc(100% - ${wheel.viewBounds.right}px) calc(100% - ${wheel.viewBounds.bottom}px) ${wheel.viewBounds.left}px)` }}>
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
          {/* Under the choices, so a tile near the axis stays readable. */}
          {!isPreview && wheel.hand && wheel.options.length > 1 && (
            <ScrollWings
              cx={wheel.x}
              cy={wheel.y}
              hub={hub}
              length={scrollWingLength(wheel.radius)}
              axes={axes}
              direction={Math.sign(wheel.scrolling)}
              quiet={Boolean(selected) || Boolean(wheel.repositioning)}
              entrance={!wheel.skipEntrance && wheel.offset === 0}
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
                        sizes="(max-width: 640px) 33vw, 120px"
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

/** Two swept wings either side of the hub, along the sideways slide that
 * scrolls. Each runs a little past where the thumb reaches full speed; the
 * one scrolling fills and its arrows run outward. */
function ScrollWings({
  cx,
  cy,
  hub,
  length,
  axes,
  direction,
  quiet,
  entrance,
}: {
  cx: number;
  cy: number;
  hub: number;
  length: number;
  axes: ReturnType<typeof wheelRailAxes>;
  /** Sign of the current scroll; 0 at rest. */
  direction: number;
  /** Fade back while a choice is held or the wheel is being moved. */
  quiet: boolean;
  entrance: boolean;
}) {
  // Decided when the wheel opens; scrolling later must not replay it.
  const [unfold] = useState(entrance);
  return (
    <g
      data-wheel-wings=""
      className="quick-wheel-wings"
      style={{
        transformOrigin: `${cx}px ${cy}px`,
        animationName: unfold ? undefined : "none",
        opacity: quiet ? 0.25 : 1,
        transition: "opacity 150ms",
      }}
    >
      {[-1, 1].map((side) => {
        const at = (out: number, up: number) => {
          const p = scrollWingPoint(cx, cy, axes, side, out, up);
          return `${p.x} ${p.y}`;
        };
        const [root, ...curves] = scrollWingOutline(hub, length).map(
          ([out, up]) => at(out, up),
        );
        const active = direction === side;
        return (
          <g
            key={side}
            data-wheel-wing={side}
            data-active={active || undefined}
            className="quick-wheel-wing"
            style={{
              opacity: direction && !active ? 0.35 : 1,
              transition: "opacity 150ms",
            }}
          >
            <path
              d={`M${root}C${curves.slice(0, 3).join(" ")}C${curves.slice(3).join(" ")}Z`}
              className={cn(
                "transition-[fill,stroke] duration-150",
                active
                  ? "fill-primary stroke-primary"
                  : "fill-primary/10 stroke-primary/35 dark:fill-primary/20",
              )}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            {[0.3, 0.58].map((share) => {
              const out = hub + (length - hub) * share;
              return (
                <path
                  key={share}
                  d={`M${at(out - 5, 7)}L${at(out + 2, 0)}L${at(out - 5, -7)}`}
                  fill="none"
                  className={cn(
                    "quick-wheel-chevron transition-[stroke] duration-150",
                    active ? "stroke-primary-foreground" : "stroke-primary/70",
                  )}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
