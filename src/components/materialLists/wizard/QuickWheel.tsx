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
}

type Wheel = Choices & {
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  radius: number;
  page: number;
  hovered: number | null;
  moved: boolean;
};
type Entry = Choice & { page?: number };
function entriesFor(wheel: Wheel): Entry[] {
  if (wheel.options.length <= 8) return wheel.options;
  const pages = Math.ceil(wheel.options.length / 6);
  return [
    ...wheel.options.slice(wheel.page * 6, wheel.page * 6 + 6),
    {
      label: "Previous",
      select: () => undefined,
      page: (wheel.page + pages - 1) % pages,
    },
    { label: "More", select: () => undefined, page: (wheel.page + 1) % pages },
  ];
}
export function wheelSector(
  dx: number,
  dy: number,
  count: number,
  radius: number,
) {
  const distance = Math.hypot(dx, dy);
  if (!count || distance < radius * 0.31 || distance > radius * 1.65)
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
  ...props
}: HTMLAttributes<HTMLDivElement> & { enabled?: boolean }) {
  const registry = useRef<Registry>({ current: null }).current;
  const surface = useRef<HTMLDivElement>(null);
  const active = useRef<Wheel | null>(null);
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageLatch = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const update = (value: Wheel | null) => {
    active.current = value;
    setWheel(value);
  };
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = () => {
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
        update({ ...current, ...choices, page: 0, hovered: null });
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
      const left = Math.max(8, bounds.left + 8),
        right = Math.min(innerWidth - 8, bounds.right - 8);
      const top = Math.max(8, bounds.top + 8),
        bottom = Math.min(innerHeight - 8, bounds.bottom - 8);
      const radius = Math.min(170, (right - left) / 2, (bottom - top) / 2);
      if (radius < 95) return;
      event.preventDefault();
      suppressClick.current = true;
      pageLatch.current = null;
      update({
        ...choices,
        pointerId: event.pointerId,
        x: Math.max(left + radius, Math.min(right - radius, event.clientX)),
        y: Math.max(top + radius, Math.min(bottom - radius, event.clientY)),
        startX: event.clientX,
        startY: event.clientY,
        radius,
        page: 0,
        hovered: null,
        moved: false,
      });
    }
    function move(event: PointerEvent) {
      const current = active.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      const moved =
        current.moved ||
        Math.hypot(
          event.clientX - current.startX,
          event.clientY - current.startY,
        ) > 12;
      const hovered = moved
        ? wheelSector(
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
          pageLatch.current = hovered;
          if (entry.page !== undefined)
            update({ ...current, page: entry.page, hovered: null });
          else {
            // Use the latest callbacks after query or pending-quantity changes.
            const index =
              current.options.length <= 8
                ? hovered!
                : current.page * 6 + hovered!;
            registry.current?.options[index]?.select();
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
    window.addEventListener("keydown", key, true);
    document.addEventListener("visibilitychange", cancel);
    element.addEventListener("touchstart", touch, { passive: false });
    window.addEventListener("touchmove", touch, { passive: false });
    element.addEventListener("click", click, true);
    element.addEventListener("contextmenu", context);
    return () => {
      clearTimer();
      active.current = null;
      element.removeEventListener("pointerdown", start);
      window.removeEventListener("pointerdown", resetClick, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
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

function WheelDisplay({ wheel }: { wheel: Wheel }) {
  const entries = entriesFor(wheel);
  const selected = wheel.hovered === null ? undefined : entries[wheel.hovered];
  const point = (angle: number, radius: number) =>
    `${170 + Math.sin(angle) * radius},${170 - Math.cos(angle) * radius}`;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100] bg-black/40 select-none"
      data-quick-wheel=""
      aria-label={`${wheel.title} quick wheel`}
      role="status"
    >
      <div
        className="absolute"
        style={{
          left: wheel.x - wheel.radius,
          top: wheel.y - wheel.radius,
          width: wheel.radius * 2,
          height: wheel.radius * 2,
        }}
      >
        <svg
          viewBox="0 0 340 340"
          className="h-full w-full drop-shadow-2xl"
          aria-hidden="true"
        >
          <circle cx="170" cy="170" r="169" fill="#111923" stroke="#738296" />
          {entries.map((entry, index) => {
            const step = (Math.PI * 2) / entries.length;
            const angle = index * step;
            const start = angle - step / 2 + 0.025,
              end = angle + step / 2 - 0.025;
            return (
              <g key={`${wheel.page}-${index}`}>
                <path
                  d={`M ${point(start, 64)} L ${point(start, 166)} A 166 166 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(end, 166)} L ${point(end, 64)} A 64 64 0 ${end - start > Math.PI ? 1 : 0} 0 ${point(start, 64)} Z`}
                  fill={index === wheel.hovered ? "#426b93" : "#202c3a"}
                  stroke="#738296"
                  strokeWidth=".6"
                />
                <foreignObject
                  x={170 + Math.sin(angle) * 117 - 43}
                  y={170 - Math.cos(angle) * 117 - 26}
                  width="86"
                  height="52"
                >
                  <div className="flex h-full items-center justify-center text-center text-[12px] leading-tight font-semibold text-white">
                    <span className="line-clamp-3 break-words">
                      {entry.page !== undefined
                        ? entry.label === "More"
                          ? "More →"
                          : "← Previous"
                        : entry.label}
                    </span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
        <div className="absolute top-1/2 left-1/2 flex w-[34%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center text-white">
          <span className="line-clamp-4 text-xs leading-tight font-semibold">
            {selected?.label ?? wheel.title}
          </span>
          <span className="text-[10px] leading-tight text-slate-300">
            {selected
              ? selected.page !== undefined
                ? "Hold to browse"
                : "Hold to select"
              : "Slide to choose"}
          </span>
          {wheel.options.length > 8 && (
            <span className="text-[10px] text-slate-400">
              {wheel.page + 1} / {Math.ceil(wheel.options.length / 6)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
