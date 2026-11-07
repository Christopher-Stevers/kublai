"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { useChatViewMemory } from "./ChatViewProvider";

/** Dynamic rows retain their measured heights while offscreen, including photo messages. */
export function VirtualChatMessages<T extends { id: string }>({
  items,
  scrollRef,
  memoryKey,
  children,
  gap = 0,
}: {
  items: T[];
  scrollRef: RefObject<HTMLDivElement | null>;
  memoryKey: string;
  children: (item: T, index: number) => ReactNode;
  gap?: number;
}) {
  "use no memo"; // Virtualizer measurement state is mutable.
  const memory = useChatViewMemory();
  const root = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [cached] = useState(() =>
    memory?.get<VirtualItem[]>(`measurements:${memoryKey}`),
  );
  const [position] = useState(() =>
    memory?.get<{ top: number; bottom: boolean }>(`scroll:${memoryKey}`),
  );
  const virtual = items.length > 100;
  const initialScrollApplied = useRef(false);
  const getItemKey = useCallback((index: number) => items[index]!.id, [items]);
  const list = useVirtualizer({
    count: items.length,
    enabled: true,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 110,
    overscan: 8,
    gap,
    scrollMargin: margin,
    initialMeasurementsCache: cached,
    initialOffset: () =>
      position?.bottom === false
        ? position.top
        : (scrollRef.current?.scrollTop ?? 0),
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
  });
  useEffect(() => {
    const element = root.current,
      parent = scrollRef.current;
    if (!element || !parent) return;
    const measure = () => {
      setMargin(
        element.getBoundingClientRect().top -
          parent.getBoundingClientRect().top +
          parent.scrollTop,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [scrollRef, virtual]);
  useEffect(() => {
    if (
      !items.length ||
      initialScrollApplied.current ||
      !list.scrollElement ||
      !list.scrollRect?.height
    )
      return;
    // The parent's ref is attached after the child's first layout effects.
    // Restore only once the virtualizer has observed that scroll container.
    initialScrollApplied.current = true;
    if (position?.bottom === false) list.scrollToOffset(position.top);
    else list.scrollToIndex(items.length - 1, { align: "end" });
  });
  useLayoutEffect(
    () => () => {
      memory?.set(`measurements:${memoryKey}`, list.takeSnapshot());
    },
    [memory, memoryKey, list],
  );
  // Measure short histories too, so crossing the virtualization threshold does
  // not replace known row heights with estimates and jump the reading position.
  const totalSize = list.getTotalSize();
  if (!virtual)
    return (
      <div ref={root} style={{ display: "flex", flexDirection: "column", gap }}>
        {items.map((item, index) => (
          <div key={item.id} data-index={index} ref={list.measureElement}>
            {children(item, index)}
          </div>
        ))}
      </div>
    );
  return (
    <div
      ref={root}
      data-virtual-chat=""
      style={{
        height: totalSize,
        position: "relative",
        overflowAnchor: "none",
      }}
    >
      {list.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={list.measureElement}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${row.start - margin}px)`,
            display: "flow-root",
          }}
        >
          {children(items[row.index]!, row.index)}
        </div>
      ))}
    </div>
  );
}
