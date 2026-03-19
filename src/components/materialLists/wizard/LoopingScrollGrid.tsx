"use client";
import { useRef, useEffect, useCallback } from "react";

interface LoopingScrollGridProps<T> {
  items: T[];
  getKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  maxHeight?: number;
  gridClassName?: string;
}

export function LoopingScrollGrid<T>({
  items,
  getKey,
  renderItem,
  maxHeight = 400,
  gridClassName = "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4",
}: LoopingScrollGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const jumping = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Start scrolled to the middle copy so both directions work
    el.scrollTop = el.scrollHeight / 3;
  }, [items]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || jumping.current) return;
    const third = el.scrollHeight / 3;
    if (el.scrollTop < third * 0.25) {
      jumping.current = true;
      el.scrollTop += third;
      jumping.current = false;
    } else if (el.scrollTop > third * 1.75) {
      jumping.current = true;
      el.scrollTop -= third;
      jumping.current = false;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto"
      style={{ maxHeight }}
      onScroll={handleScroll}
    >
      {[0, 1, 2].map((copy) => (
        <div key={copy} className={`${gridClassName} ${copy < 2 ? "mb-2" : ""}`}>
          {items.map((item) => (
            <div key={`${copy}-${getKey(item)}`}>{renderItem(item)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
