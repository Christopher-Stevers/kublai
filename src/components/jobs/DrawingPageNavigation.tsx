"use client";
import type { Ref } from "react";
import { ChevronLeftIcon, ChevronRightIcon, MaximizeIcon } from "lucide-react";
import { Button } from "~/components/ui/button";

/** Shared navigation for Drawings and document PDFs. */
export function DrawingPageNavigation({
  scrollPages = false,
  name,
  index,
  count,
  zoom = 1,
  zoomRef,
  nameControl,
  fullscreenRef,
  onPrevious,
  onNext,
  onFullscreen,
}: {
  scrollPages?: boolean;
  name: string;
  index: number;
  count: number;
  zoom?: number;
  zoomRef?: Ref<HTMLSpanElement>;
  nameControl?: React.ReactNode;
  fullscreenRef?: Ref<HTMLButtonElement>;
  onPrevious: () => void;
  onNext: () => void;
  onFullscreen: () => void;
}) {
  return (
    <div
      data-drawing-chrome
      className="bg-card shrink-0 px-3 pt-0.5 pb-[calc(0.25rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] items-center gap-2">
        {!scrollPages && <Button
          variant="outline"
          className="h-9 min-w-0 rounded-lg px-2 text-sm"
          disabled={index <= 0}
          onClick={onPrevious}
        >
          <ChevronLeftIcon className="mr-1 h-4 w-4" />
          Previous
        </Button>}
        <div className={`flex min-w-0 flex-col items-center ${scrollPages ? "col-span-3" : ""}`}>
          <div className="flex w-full min-w-0 items-center justify-center gap-1.5">
            {nameControl ?? (
              <span
                className="min-w-0 truncate py-1 text-center text-sm"
                title={name}
              >
                {name}
              </span>
            )}
            <span
              ref={zoomRef}
              aria-label="Drawing zoom"
              title="Zoom (100% = fit to screen)"
              className="text-muted-foreground shrink-0 text-xs tabular-nums"
            >
              {Math.round(zoom * 100)}%
            </span>
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <span className="text-muted-foreground text-xs tabular-nums">
              {index + 1} of {count}
            </span>
            <Button
              ref={fullscreenRef}
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label="Full screen"
              title="Full screen"
              onClick={onFullscreen}
            >
              <MaximizeIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        {!scrollPages && <Button
          variant="outline"
          className="h-9 min-w-0 rounded-lg px-2 text-sm"
          disabled={index >= count - 1}
          onClick={onNext}
        >
          Next
          <ChevronRightIcon className="ml-1 h-4 w-4" />
        </Button>}
      </div>
    </div>
  );
}
