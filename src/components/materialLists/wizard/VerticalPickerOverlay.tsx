"use client";

import type { ReactNode } from "react";

const ACTIVE_TEXT_SHADOW =
  "0 0 2px rgba(255,255,255,1), 0 0 6px rgba(255,255,255,0.85), 0 0 12px rgba(0,0,0,0.95), 0 0 26px rgba(0,0,0,0.9), 0 0 42px rgba(0,0,0,0.78)";
const INACTIVE_TEXT_SHADOW =
  "0 0 2px rgba(255,255,255,0.85), 0 0 10px rgba(0,0,0,0.72), 0 0 22px rgba(0,0,0,0.58)";
const SUBTITLE_TEXT_SHADOW =
  "0 0 2px rgba(255,255,255,0.9), 0 0 8px rgba(15,23,42,0.78), 0 0 18px rgba(0,0,0,0.58)";

export function VerticalPickerOverlay<T>({
  title,
  subtitle,
  centerIndex,
  getItem,
  renderItem,
  getItemFontSize,
  activeFontSize = "4.5rem",
  nearFontSize = "2.75rem",
  farFontSize = "1.6rem",
  className = "fixed",
}: {
  title: string;
  subtitle?: ReactNode;
  centerIndex: number;
  getItem: (index: number) => T | null;
  renderItem: (item: T) => ReactNode;
  getItemFontSize?: (item: T, distance: number) => string | undefined;
  activeFontSize?: string;
  nearFontSize?: string;
  farFontSize?: string;
  className?: "fixed" | "absolute";
}) {
  return (
    <div
      className={`${className} inset-0 z-[90] flex touch-none select-none bg-black/20 backdrop-blur-[1px]`}
      style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
    >
      <div className="flex h-full w-full p-2 sm:p-3">
        <div
          className="flex h-full w-full flex-col rounded-[2rem] bg-white/18 px-4 py-5 text-slate-950 shadow-2xl ring-1 ring-white/20 backdrop-blur-md sm:px-8 sm:py-8"
          style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
        >
          <div className="mb-6 text-center sm:mb-8">
            <div className="text-base font-medium uppercase tracking-[0.22em] text-slate-900/80 sm:text-lg">
              {title}
            </div>
            {subtitle && (
              <div
                className="mt-2 line-clamp-2 text-base font-semibold text-slate-950 sm:text-xl"
                style={{
                  WebkitTextStroke: "0.35px rgba(255,255,255,0.7)",
                  textShadow: SUBTITLE_TEXT_SHADOW,
                }}
              >
                {subtitle}
              </div>
            )}
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <div className="absolute inset-x-0 top-1/2 h-20 -translate-y-1/2 rounded-3xl border border-white/35 bg-white/20 shadow-inner sm:h-24" />
            <div className="absolute inset-x-0 flex flex-col items-center transition-transform duration-75 ease-out">
              {Array.from({ length: 13 }, (_, visibleIndex) => {
                const rawIndex = centerIndex - 6 + visibleIndex;
                const item = getItem(rawIndex);
                const distance = Math.abs(rawIndex - centerIndex);
                const opacity = item === null ? 0 : Math.max(0.3, 1 - distance * 0.14);
                const scale = Math.max(0.72, 1 - distance * 0.08);
                const isActive = distance === 0;
                const fontSize =
                  item === null
                    ? farFontSize
                    : getItemFontSize?.(item, distance) ??
                      (isActive
                        ? activeFontSize
                        : distance === 1
                          ? nearFontSize
                          : farFontSize);

                return (
                  <div
                    key={`${centerIndex}-${rawIndex}-${visibleIndex}`}
                    className="flex h-16 max-w-full select-none items-center justify-center px-3 text-center font-black leading-none tracking-normal sm:h-20"
                    style={{
                      opacity,
                      color: isActive ? "#020617" : "#0f172a",
                      transform: `scale(${scale})`,
                      fontSize,
                      WebkitTextStroke: isActive
                        ? "1.35px rgba(255,255,255,0.92)"
                        : "0.75px rgba(255,255,255,0.62)",
                      textShadow: isActive ? ACTIVE_TEXT_SHADOW : INACTIVE_TEXT_SHADOW,
                    }}
                  >
                    {item === null ? "" : renderItem(item)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
