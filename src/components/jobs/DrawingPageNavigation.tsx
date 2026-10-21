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
      className="bg-background/85 pointer-events-none absolute top-3 right-3 z-20 rounded-md px-3 py-1.5 text-base font-medium tabular-nums shadow-sm transition-opacity duration-500 data-[idle=true]:opacity-0"
    >
      {Math.round(zoom * 100)}%
    </span>
  );
}

/** Shared navigation for Drawings and document PDFs. */
export function DrawingPageNavigation({
  name,
  index,
  count,
  onPrevious,
  onNext,
}: {
  scrollPages?: boolean;
  name: string;
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div
      data-drawing-chrome
      className="bg-card shrink-0 px-3 pt-0.5 pb-[calc(0.25rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] items-center gap-2">
        <Button
          variant="outline"
          className="h-9 min-w-0 rounded-lg px-2 text-sm"
          disabled={index <= 0}
          onClick={onPrevious}
        >
          <ChevronLeftIcon className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <div className="flex min-w-0 flex-col items-center">
          <div className="flex w-full min-w-0 items-center justify-center gap-1.5">
            <span
              className="min-w-0 truncate py-1 text-center text-sm"
              title={name}
            >
              {name}
            </span>
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {index + 1} of {count}
          </span>
        </div>
        <Button
          variant="outline"
          className="h-9 min-w-0 rounded-lg px-2 text-sm"
          disabled={index >= count - 1}
          onClick={onNext}
        >
          Next
          <ChevronRightIcon className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
