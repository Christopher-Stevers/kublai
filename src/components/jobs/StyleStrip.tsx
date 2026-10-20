"use client";
import type { ReactNode } from "react";
import { useSideScroll } from "~/hooks/use-side-scroll";
import { LINE_WIDTHS, MEASURE_COLORS } from "~/lib/sheet-measure-color";

const SCROLLER = "flex min-w-0 flex-1 basis-0 items-center overflow-x-auto overflow-y-hidden [scrollbar-width:none]";

/**
 * Colours and line widths side by side on one line, each taking half and
 * scrolling sideways when its choices don't fit; `end` (such as Fill) sits after.
 */
export function StyleStrip({
  color,
  onColor,
  colorLabel,
  customColorLabel,
  width,
  onWidth,
  widthLabel = "Line width",
  disabled,
  end,
}: {
  color: string;
  onColor: (color: string) => void;
  colorLabel: string;
  /** Offer a custom colour after the swatches, labelled with this. */
  customColorLabel?: string;
  width?: number;
  /** Without this only the colours show. */
  onWidth?: (width: number) => void;
  widthLabel?: string;
  disabled?: boolean;
  end?: ReactNode;
}) {
  const current = color.slice(0, 7).toLowerCase();
  // The padding leaves room for the chosen swatch's ring.
  const [colourList, colourFade] = useSideScroll<HTMLDivElement>('[aria-pressed="true"]', current);
  const [widthList, widthFade] = useSideScroll<HTMLDivElement>('[aria-checked="true"]', width);
  return (
    <div className="flex items-center gap-2">
      <div ref={colourList} style={colourFade} role="group" aria-label={colorLabel} className={`${SCROLLER} gap-1.5 p-1.5`}>
        {MEASURE_COLORS.map((item) => {
          const active = current === item.value.toLowerCase();
          return (
            <button
              key={item.value}
              type="button"
              aria-label={item.name}
              title={item.name}
              aria-pressed={active}
              disabled={disabled}
              className={`size-7 shrink-0 rounded-full border border-black/15 shadow-sm transition-transform duration-150 hover:scale-110 active:scale-95 disabled:opacity-50 motion-reduce:transition-none ${active ? "ring-primary ring-offset-card ring-2 ring-offset-2" : ""}`}
              style={{ backgroundColor: item.value }}
              onClick={() => onColor(item.value)}
            />
          );
        })}
        {customColorLabel && (
          <label
            className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-full border shadow-sm"
            title="Custom colour"
            style={{
              background:
                "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
            }}
          >
            <input
              aria-label={customColorLabel}
              type="color"
              value={current}
              disabled={disabled}
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(event) => onColor(event.target.value)}
            />
          </label>
        )}
      </div>
      {onWidth && (
        <div
          ref={widthList}
          style={widthFade}
          role="radiogroup"
          aria-label={widthLabel}
          className={`${SCROLLER} bg-muted rounded-full p-0.5`}
        >
          {LINE_WIDTHS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={width === option}
              aria-label={`Width ${option}`}
              disabled={disabled}
              className={`flex h-7 min-w-9 flex-1 shrink-0 items-center justify-center rounded-full transition-colors ${width === option ? "bg-background shadow-sm" : "hover:bg-background/50"}`}
              onClick={() => onWidth(option)}
            >
              <span
                aria-hidden="true"
                className="w-4 rounded-full"
                style={{ height: Math.max(1, option * 0.9), backgroundColor: current }}
              />
            </button>
          ))}
        </div>
      )}
      {end}
    </div>
  );
}
