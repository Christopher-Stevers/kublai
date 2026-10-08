"use client";

import { useId, useState } from "react";
import type { DrawingSize, DrawingView } from "~/lib/drawing-viewport";
import {
  DEFAULT_OVERLAY_STYLES,
  type OverlayInkStyle,
} from "~/lib/drawing-line-overlay";
import { DrawingLineOverlayLayer } from "./DrawingLineOverlayLayer";
import { DrawingPdfLayer } from "./DrawingPdfLayer";

export type ComparisonSource = {
  src: string;
  pdf?: { url: string; page: number } | null;
};
export type DrawingComparison = ComparisonSource & {
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
}: {
  comparison: DrawingComparison;
  primary: ComparisonSource;
  fit: DrawingSize;
  frameSize: DrawingSize;
  view: DrawingView;
  dpr: number;
}) {
  const filterId = useId().replace(/:/g, "");
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
  if (comparison.mode === "overlay")
    return (
      <DrawingLineOverlayLayer
        first={primary}
        second={comparison}
        styles={[
          comparison.primaryInk ?? DEFAULT_OVERLAY_STYLES[0],
          comparison.secondaryInk ?? DEFAULT_OVERLAY_STYLES[1],
        ]}
        alignment={comparison.alignment}
        fit={fit}
        frameSize={frameSize}
        view={view}
        dpr={dpr}
      />
    );
  const difference = comparison.mode === "difference";
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
        moving={false}
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
      <svg className="absolute size-0">
        <defs>
          <filter id={`${filterId}-red`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 1 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0"
            />
          </filter>
          <filter id={`${filterId}-blue`} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0 0 1 0 0 0 0 0 0 0 1 0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>
      {difference && (
        <div
          className="absolute inset-0"
          style={{ filter: `url(#${filterId}-red)`, backgroundColor: "#fff" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={primary.src}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full"
          />
          {pdf(primary, fit, view)}
        </div>
      )}
      <div
        className="absolute"
        style={{
          width: fit.width,
          height: geometry.fit.height,
          top: geometry.top,
          left: 0,
          transformOrigin: "center",
          transform: `translate(${comparison.alignment.x * fit.width}px, ${comparison.alignment.y * fit.height}px) scale(${geometry.scale})`,
          opacity: difference ? 1 : comparison.opacity,
          mixBlendMode: difference ? "multiply" : undefined,
          filter: difference ? `url(#${filterId}-blue)` : undefined,
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
