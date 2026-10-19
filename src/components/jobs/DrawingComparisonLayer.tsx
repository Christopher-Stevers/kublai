"use client";

import { useState, type RefObject } from "react";
import type { DrawingSize, DrawingView } from "~/lib/drawing-viewport";
import {
  DEFAULT_OVERLAY_STYLES,
  type OverlayInkStyle,
} from "~/lib/drawing-line-overlay";
import {
  DEFAULT_DRAWING_APPEARANCE,
  type DrawingAppearance,
} from "~/lib/drawing-appearance";
import { DrawingLineOverlayLayer } from "./DrawingLineOverlayLayer";
import { DrawingPdfLayer } from "./DrawingPdfLayer";

export type ComparisonSource = {
  src: string;
  pdf?: { url: string; page: number } | null;
};
export type DrawingComparison = ComparisonSource & {
  additional?: Array<
    ComparisonSource & {
      ink: OverlayInkStyle;
      alignment: DrawingComparison["alignment"];
    }
  >;
  mode: "overlay" | "difference" | "wipe";
  opacity: number;
  primaryInk?: OverlayInkStyle;
  secondaryInk?: OverlayInkStyle;
  wipe: number;
  alignment: { x: number; y: number; scale: number };
};

export function comparisonGeometry(
  fit: DrawingSize,
  view: DrawingView,
  aspect: number,
  alignment: DrawingComparison["alignment"],
) {
  const height = fit.width * aspect;
  const scale = Math.min(4, Math.max(0.25, alignment.scale));
  return {
    fit: { width: fit.width, height },
    top: (fit.height - height) / 2,
    scale,
    view: {
      scale: view.scale * scale,
      x: view.x + alignment.x * fit.width * view.scale,
      y: view.y + alignment.y * fit.height * view.scale,
    },
  };
}

/** Shares the primary viewer's compositor transform; comparison never captures gestures. */
export function DrawingComparisonLayer({
  comparison,
  primary,
  fit,
  frameSize,
  view,
  dpr,
  appearance = DEFAULT_DRAWING_APPEARANCE,
  appearanceFilter,
  screenSpace,
  moving = false,
  paintRef,
}: {
  comparison: DrawingComparison;
  primary: ComparisonSource;
  fit: DrawingSize;
  frameSize: DrawingSize;
  view: DrawingView;
  dpr: number;
  appearance?: DrawingAppearance;
  appearanceFilter?: string;
  screenSpace?: boolean;
  moving?: boolean;
  paintRef?: RefObject<((view: DrawingView) => void) | null>;
}) {
  const [image, setImage] = useState<{
    src: string;
    width: number;
    height: number;
  } | null>(null);
  const aspect =
    image?.src === comparison.src
      ? image.height / image.width
      : fit.height / fit.width;
  const geometry = comparisonGeometry(fit, view, aspect, comparison.alignment);
  if (comparison.mode === "overlay" || comparison.mode === "difference")
    return (
      <DrawingLineOverlayLayer
        screenSpace={screenSpace}
        moving={moving}
        paintRef={paintRef}
        inverted={appearance.inverted}
        first={primary}
        second={comparison}
        additional={comparison.additional?.map((layer) => ({
          source: layer,
          style: layer.ink,
          alignment: layer.alignment,
        }))}
        styles={
          comparison.mode === "difference"
            ? DEFAULT_OVERLAY_STYLES
            : [
                comparison.primaryInk ?? DEFAULT_OVERLAY_STYLES[0],
                comparison.secondaryInk ?? DEFAULT_OVERLAY_STYLES[1],
              ]
        }
        alignment={comparison.alignment}
        fit={fit}
        frameSize={frameSize}
        view={view}
        dpr={dpr}
      />
    );
  const pdf = (
    source: ComparisonSource,
    size: DrawingSize,
    currentView: DrawingView,
  ) =>
    source.pdf ? (
      <DrawingPdfLayer
        pdf={source.pdf}
        fit={size}
        frameSize={frameSize}
        view={currentView}
        dpr={dpr}
        enabled
        moving={moving}
      />
    ) : null;
  return (
    <div
      data-drawing-comparison={comparison.mode}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 2,
        isolation: "isolate",
        clipPath:
          comparison.mode === "wipe"
            ? `inset(0 ${100 - comparison.wipe * 100}% 0 0)`
            : undefined,
      }}
    >
      <div
        className="absolute"
        style={{
          width: fit.width,
          height: geometry.fit.height,
          top: geometry.top,
          left: 0,
          transformOrigin: "center",
          transform: `translate(${comparison.alignment.x * fit.width}px, ${comparison.alignment.y * fit.height}px) scale(${geometry.scale})`,
          opacity: comparison.opacity,
          filter: appearanceFilter,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={comparison.src}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full"
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0)
              setImage({
                src: comparison.src,
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
          }}
        />
        {pdf(comparison, geometry.fit, geometry.view)}
      </div>
    </div>
  );
}
