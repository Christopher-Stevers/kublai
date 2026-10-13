"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";

import { cn } from "~/lib/utils";
import {
  quickWheelLayout,
  curvedChoiceAt,
  wheelDeadZoneRadius,
  type WheelBounds,
} from "./quick-wheel-layout";

import {
  inwardSlots,
  wheelUsageId,
  type WheelUsage,
} from "./quick-wheel-usage";

type Choice = { label: string; select: () => void };
type Choices = { title: string; options: Choice[] };
type Registry = {
  current: Choices | null;
  changed?: (choices: Choices) => void;
};
const WheelContext = createContext<Registry | null>(null);

/** Each stage supplies the same actions used by its cards, including off-page choices. */
export function useQuickWheelOptions(title: string, options: Choice[]) {
  const registry = useContext(WheelContext);
  useLayoutEffect(() => {
    if (!registry) return;
    const value = { title, options };
    registry.current = value;
    registry.changed?.(value);
    return () => {
      if (registry.current === value) registry.current = null;
    };
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
  page: number;
  hovered: number | null;
  moved: boolean;
};
type Entry = Choice & { page?: number; sourceIndex?: number };
function entriesFor(wheel: Wheel): Entry[] {
  const ranked = wheel.options.map((choice, sourceIndex) => ({
    ...choice,
    sourceIndex,
  }));
  const frequency = (entry: Entry) =>
    wheel.usage[wheelUsageId(wheel.title, entry.label)] ?? 0;
  ranked.sort(
    (a, b) => frequency(b) - frequency(a) || a.sourceIndex - b.sourceIndex,
  );
  const pages = Math.ceil(ranked.length / 6);
  const entries: Entry[] =
    ranked.length <= 8
      ? ranked
      : [
          ...ranked.slice(wheel.page * 6, wheel.page * 6 + 6),
          {
            label: "Previous",
            select: () => undefined,
            page: (wheel.page + pages - 1) % pages,
          },
          {
            label: "More",
            select: () => undefined,
            page: (wheel.page + 1) % pages,
          },
        ];
  if (!ranked.some((entry) => frequency(entry) > 0)) return entries;
  const layout = quickWheelLayout(
    wheel.x,
    wheel.y,
    wheel.radius,
    entries.length,
    wheel.bounds,
  );
  const points =
    layout.kind === "curved"
      ? layout.choices.map((choice) => choice.label)
      : entries.map((_, index) => ({
          x:
            wheel.x +
            (Math.sin((index * Math.PI * 2) / entries.length) *
              wheel.radius *
              RING) /
              170,
          y:
            wheel.y -
            (Math.cos((index * Math.PI * 2) / entries.length) *
              wheel.radius *
              RING) /
              170,
        }));
  const slots = inwardSlots(points, wheel.screenCentre);
  const arranged: Entry[] = [];
  entries.forEach((entry, index) => {
    arranged[slots[index]!] = entry;
  });
  return arranged;
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

/** Hold blank workspace and dwell to choose. Releasing only dismisses the wheel. */
export function QuickWheelSurface({
  children,
  enabled = true,
  usage = {},
  ...props
}: HTMLAttributes<HTMLDivElement> & { enabled?: boolean; usage?: WheelUsage }) {
  const orderUsage = useRef(usage);
  orderUsage.current = usage;
  const registry = useRef<Registry>({ current: null }).current;
  const surface = useRef<HTMLDivElement>(null);
  const active = useRef<Wheel | null>(null);
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageLatch = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const pointerPosition = useRef({ x: 0, y: 0 });
  const update = (value: Wheel | null) => {
    active.current = value;
    setWheel(value);
  };
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = () => {
    const pointerId = active.current?.pointerId;
    if (
      pointerId !== undefined &&
      surface.current?.hasPointerCapture?.(pointerId)
    )
      surface.current.releasePointerCapture(pointerId);
    clearTimer();
    pageLatch.current = null;
    update(null);
  };

  useLayoutEffect(() => {
    registry.changed = (choices) => {
      const current = active.current;
      if (!current) return;
      const changed =
        choices.title !== current.title ||
        JSON.stringify(choices.options.map((o) => o.label)) !==
          JSON.stringify(current.options.map((o) => o.label));
      if (changed) {
        clearTimer();
        // Leave the selected direction before arming another choice.
        pageLatch.current = current.hovered;
        update({
          ...current,
          ...choices,
          usage: orderUsage.current,
          page: 0,
          hovered: null,
        });
      } else {
        active.current = { ...current, options: choices.options };
      }
    };
    return () => {
      registry.changed = undefined;
    };
  }, [registry]);

  useEffect(() => {
    const element = surface.current;
    if (!element || !enabled) {
      close();
      return;
    }
    function start(event: PointerEvent) {
      if (active.current) {
        close();
        return;
      }
      if (
        event.button !== 0 ||
        event.isPrimary === false ||
        !(event.target instanceof Element) ||
        event.target.closest(interactive)
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
          viewportTop + (viewport?.height ?? innerHeight) - 24,
          bounds.bottom - 8,
        );
      const radius = Math.min(170, (right - left) / 2, (bottom - top) / 2);
      if (radius < 95) return;
      event.preventDefault();
      // Stage cards/headings are replaced when entering Parts. Keep the
      // gesture owned by this stable surface, not the removed touch target.
      element!.setPointerCapture?.(event.pointerId);
      suppressClick.current = true;
      pointerPosition.current = { x: event.clientX, y: event.clientY };
      pageLatch.current = null;
      update({
        ...choices,
        pointerId: event.pointerId,
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
        page: 0,
        hovered: null,
        moved: false,
      });
    }
    function move(event: PointerEvent) {
      const current = active.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      pointerPosition.current = { x: event.clientX, y: event.clientY };
      const moved =
        current.moved ||
        Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY,
        ) > 12;
      const layout = quickWheelLayout(
        current.x,
        current.y,
        current.radius,
        entriesFor(current).length,
        current.bounds,
      );
      const hovered = moved
        ? layout.kind === "curved"
          ? curvedChoiceAt(
              layout,
              event.clientX,
              event.clientY,
              current.x,
              current.y,
            )
          : wheelSector(
              event.clientX - current.x,
              event.clientY - current.y,
              entriesFor(current).length,
              current.radius,
            )
        : null;
      if (hovered === current.hovered && moved === current.moved) return;
      clearTimer();
      if (hovered !== pageLatch.current) pageLatch.current = null;
      const next = { ...current, hovered, moved };
      update(next);
      const entry = hovered === null ? null : entriesFor(next)[hovered];
      if (entry && pageLatch.current === null) {
        timer.current = setTimeout(() => {
          timer.current = null;
          const current = active.current;
          if (
            !current ||
            current.hovered !== hovered ||
            current.page !== next.page ||
            current.title !== next.title
          )
            return;
          // Start the next choice directly under the finger, even when it
          // moved within the same sector during the dwell timer.
          const { x, y } = pointerPosition.current;
          pageLatch.current = null;
          update({
            ...current,
            x,
            y,
            startX: x,
            startY: y,
            page: entry.page ?? current.page,
            hovered: null,
            moved: false,
          });
          if (entry.page === undefined) {
            // Use the latest callbacks after query or pending-quantity changes.
            const choice =
              entry.sourceIndex === undefined
                ? undefined
                : registry.current?.options[entry.sourceIndex];
            if (choice) {
              choice.select();
            }
          }
        }, 500);
      }
    }
    function end(event: PointerEvent) {
      const current = active.current;
      if (!current || event.pointerId !== current.pointerId) return;
      close();
      event.preventDefault();
    }

    function cancel() {
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
    function resetClick() {
      if (!active.current) suppressClick.current = false;
    }
    function context(event: Event) {
      if (active.current) event.preventDefault();
    }
    element.addEventListener("pointerdown", start);
    window.addEventListener("pointerdown", resetClick, true);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
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
    element.addEventListener("contextmenu", context);
    return () => {
      clearTimer();
      const pointerId = active.current?.pointerId;
      if (pointerId !== undefined && element.hasPointerCapture?.(pointerId))
        element.releasePointerCapture(pointerId);
      active.current = null;
      element.removeEventListener("pointerdown", start);
      window.removeEventListener("pointerdown", resetClick, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
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
      element.removeEventListener("contextmenu", context);
    };
  }, [enabled]); // The gesture reads fresh stage callbacks from registry, without restarting on renders.

  return (
    <WheelContext.Provider value={registry}>
      <div {...props} ref={surface}>
        {children}
        {wheel && <WheelDisplay wheel={wheel} />}
      </div>
    </WheelContext.Provider>
  );
}

/** Where the round choices sit on the full wheel (340-unit drawing space). */
const RING = 138;

function WheelDisplay({ wheel }: { wheel: Wheel }) {
  const entries = entriesFor(wheel);
  const selected = wheel.hovered === null ? undefined : entries[wheel.hovered];
  const layout = quickWheelLayout(
    wheel.x,
    wheel.y,
    wheel.radius,
    entries.length,
    wheel.bounds,
  );
  const pages = Math.ceil(wheel.options.length / 6);
  const hint = selected
    ? selected.page !== undefined
      ? "Hold to browse"
      : "Hold to select"
    : "Slide to choose";
  const labelOf = (entry: Entry) =>
    entry.page !== undefined
      ? entry.label === "More"
        ? "More →"
        : "← Previous"
      : entry.label;
  const tileClass = (index: number, entry: Entry) =>
    cn(
      "quick-wheel-tile flex h-full w-full items-center justify-center rounded-full border p-1.5 text-center leading-tight font-semibold shadow-md transition-[scale,background-color,color,box-shadow] duration-150 ease-out",
      wheel.hovered === index
        ? "bg-primary text-primary-foreground border-primary ring-primary/25 scale-110 shadow-lg ring-4"
        : entry.page !== undefined
          ? "bg-card text-muted-foreground"
          : "bg-card text-card-foreground",
    );
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100] select-none"
      data-quick-wheel=""
      data-layout={layout.kind}
      data-origin-x={wheel.x}
      data-origin-y={wheel.y}
      aria-label={`${wheel.title} quick wheel`}
      role="status"
    >
      <div
        className="quick-wheel-backdrop bg-background/75 absolute inset-x-0 bottom-0 backdrop-blur-md"
        style={{ top: wheel.overlayTop }}
      />
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
        <p className="text-foreground text-lg font-semibold">{wheel.title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Slide to a choice and hold to pick it
        </p>
      </div>
      {layout.kind === "curved" ? (
        (() => {
          const points = layout.choices.map((choice) => choice.label);
          const gap = points.length
            ? Math.min(
                ...points.map((point, index) => {
                  const next = points[(index + 1) % points.length]!;
                  return points.length > 1
                    ? Math.hypot(next.x - point.x, next.y - point.y)
                    : 200;
                }),
              )
            : 200;
          // Round choices sized to the spacing between them.
          const width = Math.max(56, Math.min(78, gap - 8)),
            height = width;
          const hub = layout.deadZoneRadius;
          const target =
            wheel.hovered === null ? undefined : points[wheel.hovered];
          return (
            <>
              <svg
                className="absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                <path
                  d={smoothCurve(points)}
                  fill="none"
                  className="stroke-border"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle
                  data-wheel-dead-zone=""
                  cx={wheel.x}
                  cy={wheel.y}
                  r={hub}
                  className="fill-card stroke-border drop-shadow-lg"
                  strokeWidth="1.5"
                />
                <circle
                  cx={wheel.x}
                  cy={wheel.y}
                  r="4"
                  className="fill-primary"
                />
                <HighlightArc
                  cx={wheel.x}
                  cy={wheel.y}
                  radius={hub + 12}
                  angle={
                    target
                      ? Math.atan2(target.x - wheel.x, wheel.y - target.y)
                      : null
                  }
                />
                {layout.choices.map((choice, index) => (
                  <foreignObject
                    key={`${wheel.page}-${index}`}
                    data-wheel-choice={index}
                    x={choice.label.x - width / 2}
                    y={choice.label.y - height / 2}
                    width={width}
                    height={height}
                    className="overflow-visible"
                  >
                    <div
                      className={cn(
                        tileClass(index, entries[index]!),
                        "text-[11px]",
                      )}
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      <span className="line-clamp-3 break-words">
                        {labelOf(entries[index]!)}
                      </span>
                    </div>
                  </foreignObject>
                ))}
              </svg>
              <div
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 text-center"
                style={{ left: wheel.x, top: wheel.y - 22, width: hub * 1.5 }}
              >
                <span
                  className={cn(
                    "line-clamp-2 text-xs leading-tight font-semibold",
                    selected ? "text-primary" : "text-foreground",
                  )}
                >
                  {selected ? labelOf(selected) : wheel.title}
                </span>
                <span className="text-muted-foreground text-[10px] leading-tight">
                  {hint}
                </span>
              </div>
            </>
          );
        })()
      ) : (
        <div
          className="absolute"
          style={{
            left: wheel.x - wheel.radius,
            top: wheel.y - wheel.radius,
            width: wheel.radius * 2,
            height: wheel.radius * 2,
          }}
        >
          {(() => {
            // Tiles keep a readable size on screen whatever the wheel's scale.
            const scale = wheel.radius / 170;
            const step = (Math.PI * 2) / entries.length;
            const chord =
              entries.length > 1 ? 2 * RING * Math.sin(step / 2) - 6 : 150;
            const width = Math.max(54 / scale, Math.min(76 / scale, chord - 6)),
              height = width;
            return (
              <svg
                viewBox="0 0 340 340"
                className="h-full w-full overflow-visible"
                aria-hidden="true"
              >
                <circle
                  cx="170"
                  cy="170"
                  r={RING}
                  fill="none"
                  className="stroke-border"
                  strokeWidth={2 / scale}
                />
                <circle
                  cx="170"
                  cy="170"
                  r="56"
                  className="fill-card stroke-border drop-shadow-lg"
                  strokeWidth={1.5 / scale}
                />
                <HighlightArc
                  cx={170}
                  cy={170}
                  radius={70}
                  strokeWidth={6 / scale}
                  angle={wheel.hovered === null ? null : wheel.hovered * step}
                />
                {entries.map((entry, index) => {
                  const angle = index * step;
                  const lift = wheel.hovered === index ? 6 / scale : 0;
                  return (
                    <foreignObject
                      key={`${wheel.page}-${index}`}
                      x={170 + Math.sin(angle) * (RING + lift) - width / 2}
                      y={170 - Math.cos(angle) * (RING + lift) - height / 2}
                      width={width}
                      height={height}
                      className="overflow-visible"
                    >
                      <div
                        className={tileClass(index, entry)}
                        style={{
                          fontSize: 12 / scale,
                          animationDelay: `${index * 20}ms`,
                        }}
                      >
                        <span className="line-clamp-3 break-words">
                          {labelOf(entry)}
                        </span>
                      </div>
                    </foreignObject>
                  );
                })}
              </svg>
            );
          })()}
          <div className="absolute top-1/2 left-1/2 flex w-[28%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 text-center">
            <span
              className={cn(
                "line-clamp-3 text-sm leading-tight font-semibold",
                selected ? "text-primary" : "text-foreground",
              )}
            >
              {selected ? labelOf(selected) : wheel.title}
            </span>
            <span className="text-muted-foreground text-[10px] leading-tight">
              {hint}
            </span>
            {wheel.options.length > 8 && (
              <span className="text-muted-foreground/80 text-[10px] tabular-nums">
                {wheel.page + 1} / {pages}
              </span>
            )}
          </div>
        </div>
      )}
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
