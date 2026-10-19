"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
};

/** Radio-style choice with a highlight that slides to the selected segment. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const root = track.current;
    if (!root) return;
    const place = () => {
      const selected = root.querySelector<HTMLElement>('[aria-checked="true"]');
      setThumb(
        selected
          ? { left: selected.offsetLeft, width: selected.offsetWidth }
          : null,
      );
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [value, options]);
  const move = (step: number) => {
    const enabled = options.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[(index + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    track.current
      ?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)
      ?.focus();
  };
  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "bg-muted relative flex min-w-0 items-center overflow-x-auto rounded-full p-0.5 [scrollbar-width:none]",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(-1);
        else return;
        event.preventDefault();
      }}
    >
      {thumb && thumb.width > 0 && (
        <span
          aria-hidden
          className="bg-background absolute top-0.5 bottom-0.5 left-0 rounded-full shadow-sm transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
          style={{
            width: thumb.width,
            transform: `translateX(${thumb.left}px)`,
          }}
        />
      )}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={option.value}
            tabIndex={selected ? 0 : -1}
            title={option.title}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "focus-visible:ring-ring relative z-10 h-8 shrink-0 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40",
              selected
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
              // Before layout runs, the selected segment still reads as chosen.
              selected && !thumb && "bg-background shadow-sm",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
