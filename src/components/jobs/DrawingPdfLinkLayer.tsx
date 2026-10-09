"use client";

import type { DrawingPdfLink } from "~/lib/drawing-text";

export function DrawingPdfLinkLayer({
  links,
  aspect,
  onActivate,
}: {
  links: DrawingPdfLink[];
  aspect: number;
  onActivate: (link: DrawingPdfLink) => void;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[2] h-full w-full"
      viewBox={`0 0 1000 ${1000 * aspect}`}
      aria-label="Original PDF hyperlinks"
    >
      {links.map((link, index) => (
        <rect
          key={index}
          role="link"
          tabIndex={0}
          aria-label={link.url ?? `Open PDF page ${link.page}`}
          x={link.left * 1000}
          y={link.top * 1000 * aspect}
          width={(link.right - link.left) * 1000}
          height={(link.bottom - link.top) * 1000 * aspect}
          className="pointer-events-auto cursor-pointer fill-transparent hover:fill-blue-500/15 focus:fill-blue-500/15 focus:outline-none"
          onClick={(event) => {
            if (event.detail === 0) onActivate(link);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onActivate(link);
            }
          }}
        >
          <title>{link.url ?? `Open PDF page ${link.page}`}</title>
        </rect>
      ))}
    </svg>
  );
}
