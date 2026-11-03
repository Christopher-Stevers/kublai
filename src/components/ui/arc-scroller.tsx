"use client";

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
import { ArrowLeftIcon, CheckIcon, XIcon } from "lucide-react";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { wheelUsageId, type WheelUsage } from "~/lib/order-wheel-usage";
import { cn } from "~/lib/utils";

export type ArcChoice = {
  label: string;
  select: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  /** Close the scroller after choosing. Otherwise it stays open for the next step. */
  dismiss?: boolean;
};
type Choices = { title: string; options: ArcChoice[] };

/** Mutable registry so stages can update their choices without re-rendering the surface. */
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
const ArcContext = createContext<Registry | null>(null);

/** Each stage supplies the same actions used by its cards. */
export function useArcScrollerOptions(title: string, options: ArcChoice[]) {
  const registry = useContext(ArcContext);
  useLayoutEffect(() => {
    if (!registry) return;
    return registry.register({ title, options });
  }, [registry, title, options]);
  return (label: string, commit?: () => void) => {
    const choice = options.find((option) => option.label === label);
    if (!choice) return;
    (commit ?? choice.select)();
  };
}

export type ArcHand = "left" | "right";
const HAND_KEY = "foremanhq:arc-hand:v1";
/** Learn the thumb side from where holds start; centre holds keep the preference. */
export function learnArcHand(x: number, left: number, width: number): ArcHand {
  let score = 0;
  try {
    const stored = Number(localStorage.getItem(HAND_KEY));
    if (Number.isFinite(stored)) score = Math.max(-4, Math.min(4, stored));
  } catch {
    /* Storage is optional. */
  }
  const position = (x - left) / Math.max(1, width);
  const evidence = position < 0.4 ? -1 : position > 0.6 ? 1 : 0;
  if (evidence) {
    score = score * 0.65 + evidence;
    try {
      localStorage.setItem(HAND_KEY, String(score));
    } catch {
      /* Private browsing. */
    }
  }
  return score === 0 ? (position < 0.5 ? "left" : "right") : score < 0 ? "left" : "right";
}

type Bounds = { left: number; top: number; right: number; bottom: number };
export type ArcGeometry = {
  hand: ArcHand;
  /** Pivot of the arc, just inside the thumb-side edge. */
  cx: number;
  cy: number;
  radius: number;
  /** Radians between neighbouring choices. */
  step: number;
  /** Choices further than this many steps from the middle are hidden. */
  half: number;
};
const SPAN = (50 * Math.PI) / 180;
const SPACING = 70;
const EDGE = 48;
/** The check button sits this far from the middle of the arc, toward the thumb. */
const CHECK_GAP = 110;

/** Fit an arc against the thumb-side edge, centred on the hold where it fits. */
export function arcGeometry(bounds: Bounds, y: number, hand: ArcHand): ArcGeometry | null {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const radius = Math.min(330, (height - 70) / (2 * Math.sin(SPAN)), (width - 190) / 0.45);
  if (radius < 120) return null;
  const reach = radius * Math.sin(SPAN) + 35;
  const cy = Math.min(Math.max(y, bounds.top + reach), bounds.bottom - reach);
  // The arc's two ends sit EDGE px in from the side; its middle bulges inward.
  const inset = radius * Math.cos(SPAN) - EDGE;
  const cx = hand === "right" ? bounds.right + inset : bounds.left - inset;
  const step = SPACING / radius;
  return { hand, cx, cy, radius, step, half: SPAN / step };
}

/** Screen position of a choice `distance` steps from the middle of the arc. */
export function arcPoint(geometry: ArcGeometry, distance: number) {
  const { cx, cy, radius, step, hand } = geometry;
  const angle = distance * step;
  return {
    x: cx + (hand === "right" ? -1 : 1) * radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

/** Change in scroll offset when the finger turns around the pivot. */
export function arcScrollDelta(
  geometry: ArcGeometry,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const a = Math.atan2(from.y - geometry.cy, (from.x - geometry.cx) * (geometry.hand === "right" ? -1 : 1));
  const b = Math.atan2(to.y - geometry.cy, (to.x - geometry.cx) * (geometry.hand === "right" ? -1 : 1));
  let delta = b - a;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return -delta / geometry.step;
}

/** Most-used first, otherwise in the stage's own order. */
export function rankArcChoices(title: string, options: ArcChoice[], usage: WheelUsage) {
  const frequency = (label: string) => usage[wheelUsageId(title, label)] ?? 0;
  return options
    .map((choice, index) => ({ choice, index }))
    .sort((a, b) => frequency(b.choice.label) - frequency(a.choice.label) || a.index - b.index)
    .map(({ choice }) => choice);
}

/** Long lists loop round, with one empty slot marking where the list ends.
 * Lists short enough to show whole stay put. */
export const arcLoops = (count: number, geometry: ArcGeometry) => count + 1 > 2.2 * geometry.half + 1;
const wrap = (value: number, period: number) => ((value % period) + period) % period;

/** Steps from the middle of the arc to choice `index`; the short way round when the list loops.
 * `index === count` is the gap. */
export function arcDistance(index: number, offset: number, count: number, geometry: ArcGeometry) {
  if (!arcLoops(count, geometry)) return index - offset;
  const period = count + 1;
  return wrap(index - offset + period / 2, period) - period / 2;
}

/** The choice in the middle of the arc, or null while the gap is there. */
export function arcFocus(offset: number, count: number, geometry: ArcGeometry) {
  if (!count) return null;
  if (!arcLoops(count, geometry)) return Math.min(count - 1, Math.max(0, Math.round(offset)));
  const index = wrap(Math.round(offset), count + 1);
  return index < count ? index : null;
}

/** Where a scroll may come to rest: on a choice, never the gap, and within the list when it does not loop. */
function restingOffset(target: number, from: number, count: number, geometry: ArcGeometry) {
  if (!arcLoops(count, geometry)) return Math.min(count - 1, Math.max(0, target));
  return wrap(target, count + 1) === count ? target + (target < from ? -1 : 1) : target;
}

/** Few choices sit centred on the arc; long lists start with the first at the top. */
const startOffset = (count: number, geometry: ArcGeometry) =>
  Math.min((count - 1) / 2, Math.floor(geometry.half));

/** Past either end the list stretches a little and springs back. */
function rubber(offset: number, max: number) {
  if (offset < 0) return -Math.min(0.6, -offset * 0.35);
  if (offset > max) return max + Math.min(0.6, (offset - max) * 0.35);
  return offset;
}

/** A choice can close the arc while its opening finger is still down; that lift must not reach the page. */
function guardLift(pointerId: number) {
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const lift = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    stop(event);
    window.removeEventListener("pointerup", lift, true);
    window.removeEventListener("pointercancel", lift, true);
    window.addEventListener("click", click, true);
    setTimeout(() => window.removeEventListener("click", click, true), 400);
  };
  const click = (event: MouseEvent) => {
    stop(event);
    window.removeEventListener("click", click, true);
  };
  window.addEventListener("pointerup", lift, true);
  window.addEventListener("pointercancel", lift, true);
}

type Open = Choices & {
  geometry: ArcGeometry;
  bounds: Bounds;
  ranked: ArcChoice[];
};
const interactive =
  'button, a, input, select, textarea, [role="button"], [role="slider"], [role="spinbutton"], [contenteditable="true"], [data-arc-ignore]';

/**
 * Hold blank workspace to open an arc of choices beside the thumb.
 * Swipe along the arc to scroll, tap a choice to pick it, tap elsewhere to close.
 */
export function ArcScrollerSurface({
  children,
  enabled = true,
  resetKey,
  usage = {},
  onBack,
  activation = "press",
  activationSelector,
  onActivate,
  onActiveChange,
  showBackdrop = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  enabled?: boolean;
  /** Close an open scroller when its host changes viewing mode. */
  resetKey?: string | number | boolean;
  usage?: WheelUsage;
  onBack?: () => void;
  /** "press": a short hold. "context": a longer hold, kept for drawing gestures. */
  activation?: "press" | "context";
  activationSelector?: string;
  onActivate?: (event: PointerEvent | MouseEvent) => void;
  onActiveChange?: (active: boolean) => void;
  showBackdrop?: boolean;
}) {
  const live = useRef({ activation, activationSelector, onActivate, onActiveChange, enabled, usage });
  useLayoutEffect(() => {
    live.current = { activation, activationSelector, onActivate, onActiveChange, enabled, usage };
  });
  const registry = useMemo(() => new Registry(), []);
  const surface = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  const [offset, setOffsetState] = useState(0);
  const offsetRef = useRef(0);
  const animation = useRef<number | null>(null);
  const drag = useRef<{
    pointerId: number;
    last: { x: number; y: number };
    start: { x: number; y: number };
    moved: boolean;
    /** The hold that opened the arc; its lift must not tap a choice. */
    opener: boolean;
    samples: Array<{ t: number; offset: number }>;
  } | null>(null);
  const suppressTap = useRef(false);
  const wheelIdle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const setOffset = (value: number) => {
    offsetRef.current = value;
    setOffsetState(value);
  };
  const stopAnimation = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };
  const show = (value: Open | null) => {
    openRef.current = value;
    setOpen(value);
  };
  const close = () => {
    stopAnimation();
    if (drag.current?.opener) guardLift(drag.current.pointerId);
    drag.current = null;
    const wasOpen = openRef.current !== null;
    show(null);
    if (wasOpen) live.current.onActiveChange?.(false);
  };
  const closeEvent = useEffectEvent(close);
  useEffect(() => {
    closeEvent();
  }, [resetKey]);
  useEffect(() => {
    if (!enabled) closeEvent();
  }, [enabled]);
  useHeaderBackOverride(activation === "context" && open ? close : null, { priority: 120 });

  /** Glide to the nearest choice, carrying the swipe's speed. */
  const settle = (velocity = 0) => {
    stopAnimation();
    const current = openRef.current;
    if (!current) return;
    const count = current.ranked.length;
    const from = offsetRef.current;
    const target = restingOffset(Math.round(from + velocity * 0.3), from, count, current.geometry);
    const period = arcLoops(count, current.geometry) ? count + 1 : 0;
    const started = performance.now();
    const duration = Math.min(520, 220 + Math.abs(target - from) * 50);
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      // Back to the first lap once it lands, so a looping offset stays small.
      setOffset(t < 1 || !period ? from + (target - from) * eased : wrap(target, period));
      animation.current = t < 1 ? requestAnimationFrame(tick) : null;
    };
    animation.current = requestAnimationFrame(tick);
  };

  useLayoutEffect(
    () =>
      registry.subscribe((choices) => {
        const current = openRef.current;
        if (!current) return;
        const ranked = rankArcChoices(choices.title, choices.options, live.current.usage);
        if (!ranked.length) return close();
        show({ ...current, ...choices, ranked });
        // A new step starts fresh; a toggle in the same list keeps its place.
        if (choices.title !== current.title) {
          stopAnimation();
          setOffset(startOffset(ranked.length, current.geometry));
        } else if (offsetRef.current > ranked.length - 1) setOffset(ranked.length - 1);
      }),
    [registry],
  );

  const beginDrag = (event: PointerEvent | React.PointerEvent, opener = false) => {
    stopAnimation();
    drag.current = {
      pointerId: event.pointerId,
      last: { x: event.clientX, y: event.clientY },
      start: { x: event.clientX, y: event.clientY },
      moved: false,
      opener,
      samples: [{ t: performance.now(), offset: offsetRef.current }],
    };
  };

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    let pending: { pointerId: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    const clearPending = () => {
      if (pending) clearTimeout(pending.timer);
      pending = null;
    };
    const eligible = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest("[data-arc-ignore], [data-arc-scroller]")) return false;
      const control = target.closest(interactive);
      // Annotation SVGs are accessible buttons, but remain part of the drawing.
      if (control && !(live.current.activation === "context" && control.hasAttribute("data-annotation-id")))
        return false;
      return !live.current.activationSelector || Boolean(target.closest(live.current.activationSelector));
    };
    const openAt = (event: PointerEvent | MouseEvent, x: number, y: number) => {
      if (!live.current.enabled || openRef.current) return false;
      const choices = registry.current;
      if (!choices?.options.length) return false;
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const vLeft = viewport?.offsetLeft ?? 0;
      const vTop = viewport?.offsetTop ?? 0;
      const bounds = {
        left: Math.max(vLeft, rect.left),
        top: Math.max(vTop, rect.top),
        right: Math.min(vLeft + (viewport?.width ?? innerWidth), rect.right),
        bottom: Math.min(vTop + (viewport?.height ?? innerHeight), rect.bottom),
      };
      const hand =
        "pointerType" in event && event.pointerType === "touch"
          ? learnArcHand(x, bounds.left, bounds.right - bounds.left)
          : x < (bounds.left + bounds.right) / 2
            ? "left"
            : "right";
      const geometry = arcGeometry(bounds, y, hand);
      if (!geometry) return false;
      const ranked = rankArcChoices(choices.title, choices.options, live.current.usage);
      live.current.onActivate?.(event);
      stopAnimation();
      setOffset(startOffset(ranked.length, geometry));
      show({ ...choices, geometry, bounds, ranked });
      live.current.onActiveChange?.(true);
      return true;
    };
    const start = (event: PointerEvent) => {
      clearPending();
      if (openRef.current || !live.current.enabled) return;
      if (event.button !== 0 || event.isPrimary === false || event.pointerType === "mouse") return;
      if (!eligible(event.target)) return;
      const { pointerId, clientX: x, clientY: y } = event;
      pending = {
        pointerId,
        x,
        y,
        timer: setTimeout(() => {
          pending = null;
          if (!openAt(event, x, y)) return;
          // The holding finger can keep going straight into a swipe.
          beginDrag(event, true);
          navigator.vibrate?.(8);
        }, live.current.activation === "context" ? 700 : 350),
      };
    };
    const move = (event: PointerEvent) => {
      if (pending && (event.pointerId !== pending.pointerId || Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8))
        clearPending();
    };
    const lift = () => clearPending();
    const context = (event: MouseEvent) => {
      if (openRef.current) {
        event.preventDefault();
        return;
      }
      if (!eligible(event.target) || !live.current.enabled) return;
      // Touch holds open on their own timer; this is the desktop right-click.
      if ((event as PointerEvent).pointerType === "touch" || pending) {
        event.preventDefault();
        return;
      }
      // The drawing's own right-click (ending a measurement) must not also run.
      if (openAt(event, event.clientX, event.clientY)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Stop the page from scrolling under a finger that is turning the arc.
    const touchMove = (event: TouchEvent) => {
      if (openRef.current && drag.current) event.preventDefault();
    };
    // The lift after a hold or swipe must not also click whatever is under it.
    const click = (event: MouseEvent) => {
      if (!suppressTap.current) return;
      suppressTap.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("pointerdown", start, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", lift, true);
    window.addEventListener("pointercancel", lift, true);
    element.addEventListener("contextmenu", context, true);
    window.addEventListener("touchmove", touchMove, { passive: false, capture: true });
    window.addEventListener("click", click, true);
    return () => {
      clearPending();
      element.removeEventListener("pointerdown", start, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", lift, true);
      window.removeEventListener("pointercancel", lift, true);
      element.removeEventListener("contextmenu", context, true);
      window.removeEventListener("touchmove", touchMove, true);
      window.removeEventListener("click", click, true);
    };
  }, [registry]);

  // Track the swiping finger anywhere on screen, including the hold that opened the arc.
  useEffect(() => {
    if (!open) return;
    const move = (event: PointerEvent) => {
      const current = drag.current;
      const arc = openRef.current;
      if (!current || !arc || event.pointerId !== current.pointerId) return;
      const point = { x: event.clientX, y: event.clientY };
      if (!current.moved && Math.hypot(point.x - current.start.x, point.y - current.start.y) < 6) return;
      current.moved = true;
      const delta = arcScrollDelta(arc.geometry, current.last, point);
      current.last = point;
      // Undo the previous stretch before adding the finger's movement.
      const raw = current.samples.at(-1)!.offset + delta;
      const now = performance.now();
      current.samples = [...current.samples.filter((sample) => now - sample.t < 120), { t: now, offset: raw }];
      setOffset(arcLoops(arc.ranked.length, arc.geometry) ? raw : rubber(raw, arc.ranked.length - 1));
    };
    const end = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      drag.current = null;
      // The canvas under the arc must not see the opening finger lift as a tap.
      if (current.opener) event.stopPropagation();
      if (current.moved || current.opener) {
        suppressTap.current = true;
        setTimeout(() => (suppressTap.current = false), 400);
      }
      if (!current.moved) return;
      const first = current.samples[0]!;
      const last = current.samples.at(-1)!;
      const seconds = (last.t - first.t) / 1000;
      settle(seconds > 0.01 ? (last.offset - first.offset) / seconds : 0);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Escape closes the arc only; it must not also cancel the drawing's tool.
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const arc = openRef.current;
        if (!arc) return;
        const from = offsetRef.current;
        const target = Math.round(from) + (event.key === "ArrowDown" ? 1 : -1);
        setOffset(restingOffset(target, from, arc.ranked.length, arc.geometry));
        settle();
      }
    };
    const cancel = () => close();
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-bind only when opening or closing
  }, [Boolean(open)]);

  useEffect(
    () => () => {
      stopAnimation();
      // A choice that changes page unmounts the arc under the holding finger.
      if (drag.current?.opener) guardLift(drag.current.pointerId);
    },
    [],
  );

  const choose = (choice: ArcChoice) => {
    if (choice.disabled) return;
    choice.select();
    if (choice.dismiss) close();
  };

  return (
    <ArcContext.Provider value={registry}>
      <div {...props} ref={surface} style={{ WebkitTouchCallout: "none", ...props.style }}>
        {children}
        {open && (
          <ArcDisplay
            open={open}
            offset={offset}
            showBackdrop={showBackdrop}
            onBack={onBack}
            onClose={close}
            onChoose={choose}
            onPointerDown={beginDrag}
            onWheel={(delta) => {
              const next = offsetRef.current + delta;
              const count = open.ranked.length;
              setOffset(arcLoops(count, open.geometry) ? next : Math.min(count - 1, Math.max(0, next)));
              stopAnimation();
              clearTimeout(wheelIdle.current);
              wheelIdle.current = setTimeout(() => settle(), 140);
            }}
          />
        )}
      </div>
    </ArcContext.Provider>
  );
}

function ArcDisplay({
  open,
  offset,
  showBackdrop,
  onBack,
  onClose,
  onChoose,
  onPointerDown,
  onWheel,
}: {
  open: Open;
  offset: number;
  showBackdrop: boolean;
  onBack?: () => void;
  onClose: () => void;
  onChoose: (choice: ArcChoice) => void;
  onPointerDown: (event: React.PointerEvent) => void;
  onWheel: (delta: number) => void;
}) {
  const { geometry, bounds, ranked, title } = open;
  const right = geometry.hand === "right";
  const { cx, cy, radius } = geometry;
  const trackStart = arcPoint(geometry, -geometry.half - 0.6);
  const trackEnd = arcPoint(geometry, geometry.half + 0.6);
  const count = ranked.length;
  const middle = arcFocus(offset, count, geometry);
  const focused = middle === null ? null : ranked[middle]!;
  const gap = arcLoops(count, geometry) ? arcDistance(count, offset, count, geometry) : null;
  const gapPoint = gap !== null && Math.abs(gap) <= geometry.half ? arcPoint(geometry, gap) : null;
  const hub = arcPoint(geometry, 0);
  const check = {
    x: right
      ? Math.min(bounds.right - 36, hub.x + CHECK_GAP)
      : Math.max(bounds.left + 36, hub.x - CHECK_GAP),
    y: cy,
  };
  return (
    <div
      data-arc-scroller=""
      role="dialog"
      aria-label={title}
      className={cn(
        "arc-scroller fixed inset-0 z-[100] touch-none select-none",
        showBackdrop && "bg-background/55 backdrop-blur-[2px]",
      )}
      onPointerDown={(event) => {
        if (event.button === 0) onPointerDown(event);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onWheel={(event) => onWheel(event.deltaY / 90)}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="pointer-events-auto absolute flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border bg-card/95 p-1 shadow-lg backdrop-blur"
        style={{ top: bounds.top + 10, left: (bounds.left + bounds.right) / 2, transform: "translateX(-50%)" }}
      >
        {onBack && (
          <button
            type="button"
            aria-label="Back one step"
            className="hover:bg-muted grid size-9 shrink-0 place-items-center rounded-full"
            onClick={onBack}
          >
            <ArrowLeftIcon className="size-4" />
          </button>
        )}
        <span className="truncate px-2 text-sm font-semibold">{title}</span>
        <button
          type="button"
          aria-label="Close"
          className="hover:bg-muted grid size-9 shrink-0 place-items-center rounded-full"
          onClick={onClose}
        >
          <XIcon className="size-4" />
        </button>
      </div>
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        <path
          d={`M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 0 ${right ? 0 : 1} ${trackEnd.x} ${trackEnd.y}`}
          className="stroke-primary/25"
          fill="none"
          strokeWidth={40}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={6} className="fill-primary/30" />
        {gapPoint && <circle data-arc-gap="" cx={gapPoint.x} cy={gapPoint.y} r={5} className="fill-primary/45" />}
      </svg>
      {ranked.map((choice, index) => {
        const distance = arcDistance(index, offset, count, geometry);
        const reach = Math.abs(distance) / geometry.half;
        if (reach > 1.08) return null;
        const point = arcPoint(geometry, distance);
        const focus = index === middle;
        // Shrink toward the ends, and swell like a dock as a choice nears the
        // middle. The peak stays under the spacing so neighbours never touch.
        const scale = 1 - 0.28 * Math.min(1, reach) ** 2 + 0.38 * Math.exp(-(distance ** 2) / 1.2);
        return (
          <button
            key={`${index}:${choice.label}`}
            type="button"
            data-arc-choice=""
            data-focus={focus || undefined}
            aria-label={choice.label}
            aria-disabled={choice.disabled || undefined}
            tabIndex={reach <= 1 ? 0 : -1}
            onClick={() => onChoose(choice)}
            className={cn(
              "absolute top-0 left-0 flex h-13 items-center gap-2.5 rounded-full border bg-card text-card-foreground shadow-md transition-[background-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring",
              right ? "flex-row-reverse pr-0.5 pl-4" : "pr-4 pl-0.5",
              focus && "border-primary/60 ring-primary/30 shadow-lg ring-2",
              choice.disabled && "text-muted-foreground opacity-60",
            )}
            style={{
              opacity: Math.max(0, Math.min(1, (1.08 - reach) * 3)) * (choice.disabled ? 0.6 : 1),
              transform: `translate(${point.x}px, ${point.y}px) translate(${right ? "calc(-100% + 1.625rem)" : "-1.625rem"}, -50%) scale(${scale})`,
              transformOrigin: right ? "calc(100% - 1.625rem) 50%" : "1.625rem 50%",
            }}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-12 shrink-0 place-items-center rounded-full [&_svg]:size-5.5",
                focus ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80",
              )}
            >
              {choice.icon ?? <span className="size-2 rounded-full bg-current" />}
            </span>
            <span className="max-w-[min(14rem,52vw)] truncate text-base font-medium">{choice.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        data-arc-check=""
        aria-label={focused ? `Choose ${focused.label}` : "Choose"}
        disabled={!focused || focused.disabled}
        onClick={() => focused && onChoose(focused)}
        className="bg-primary text-primary-foreground focus-visible:ring-ring absolute top-0 left-0 grid size-14 place-items-center rounded-full shadow-lg transition-opacity outline-none focus-visible:ring-2 disabled:opacity-40"
        style={{ transform: `translate(${check.x}px, ${check.y}px) translate(-50%, -50%)` }}
      >
        <CheckIcon className="size-7" strokeWidth={2.75} />
      </button>
    </div>
  );
}
