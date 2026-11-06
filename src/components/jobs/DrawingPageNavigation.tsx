"use client";
import { useCallback, useEffect, useRef, type Ref } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "~/components/ui/button";

const ZOOM_IDLE_MS = 2000;
const idleTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

/** Show the zoom readout, then let it fade once zooming has stopped for a moment. */
export function showZoomReadout(element: HTMLElement | null, text?: string) {
  if (!element) return;
  if (text !== undefined) {
    if (element.textContent === text) return;
    element.textContent = text;
  }
  element.dataset.idle = "false";
  clearTimeout(idleTimers.get(element));
  idleTimers.set(
    element,
    setTimeout(() => {
      element.dataset.idle = "true";
    }, ZOOM_IDLE_MS),
  );
}

/** Transient zoom feedback, anchored to the viewing area rather than the bottom bar. */
export function DrawingZoomReadout({
  zoom = 1,
  zoomRef,
}: {
  zoom?: number;
  zoomRef?: Ref<HTMLSpanElement>;
}) {
  const readout = useRef<HTMLSpanElement | null>(null);
  const attachReadout = useCallback(
    (element: HTMLSpanElement | null) => {
      readout.current = element;
      setRef(zoomRef, element);
    },
    [zoomRef],
  );
  useEffect(() => {
    const element = readout.current;
    showZoomReadout(element);
    return () => {
      if (element) clearTimeout(idleTimers.get(element));
    };
  }, []);
  return (
    <span
      ref={attachReadout}
      aria-label="Drawing zoom"
      title="Zoom (100% = fit to screen)"
      className="bg-background/60 border-border/60 pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border px-3 py-1.5 text-base font-medium tabular-nums shadow-md backdrop-blur-sm transition-opacity duration-500 data-[idle=true]:opacity-0"
    >
      {Math.round(zoom * 100)}%
    </span>
  );
}

/** Shared navigation for Drawings and document PDFs. */
export function DrawingPageNavigation({
  name,
  title,
  index,
  count,
  onPrevious,
  onNext,
}: {
  scrollPages?: boolean;
  name: string;
  /** The sheet title, shown under its number. */
  title?: string;
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const subtitle = title && title !== name ? title : null;
  const position = (
    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
      {index + 1} of {count}
    </span>
  );
  return (
    <div
      data-drawing-chrome
      className="bg-card shrink-0 px-3 pt-0.5 pb-[calc(0.25rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <Button
          variant="outline"
          className="h-9 min-w-9 rounded-lg px-2 text-sm"
          disabled={index <= 0}
          onClick={onPrevious}
        >
          <ChevronLeftIcon className="h-4 w-4 sm:mr-1" />
          <span className="sr-only sm:not-sr-only">Previous</span>
        </Button>
        {/* The same height with or without a title, so the bar never grows. */}
        <div className="flex h-11 min-w-0 flex-col items-center justify-center">
          {subtitle ? (
            <>
              <div className="flex w-full min-w-0 items-baseline justify-center gap-1.5 leading-5">
                <span className="min-w-0 truncate text-sm" title={name}>
                  {name}
                </span>
                {position}
              </div>
              <span
                className="w-full min-w-0 truncate text-center text-xs leading-4"
                title={subtitle}
              >
                {subtitle}
              </span>
            </>
          ) : (
            <>
              <span
                className="w-full min-w-0 truncate text-center text-sm leading-5"
                title={name}
              >
                {name}
              </span>
              {position}
            </>
          )}
        </div>
        <Button
          variant="outline"
          className="h-9 min-w-9 rounded-lg px-2 text-sm"
          disabled={index >= count - 1}
          onClick={onNext}
        >
          <span className="sr-only sm:not-sr-only">Next</span>
          <ChevronRightIcon className="h-4 w-4 sm:ml-1" />
        </Button>
      </div>
    </div>
  );
}
