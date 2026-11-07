"use client";

import Image, { type ImageProps } from "next/image";
import layouts from "~/lib/part-image-layouts.json";

type Layout = { width: number; height: number; box: number[]; background: string | null };
const audited = layouts as Record<string, Layout>;

/** Reversible framing of audited product photos. The original pixels stay intact.
 * A matching background fills letterboxing; only verified empty margins are hidden.
 * SVG viewBox works on Safari too, unlike CSS object-view-box.
 */
export default function PartImage(props: ImageProps) {
  const layout = typeof props.src === "string" ? audited[props.src] : undefined;
  if (!layout || !layout.background || typeof props.src !== "string") return <Image {...props} />;
  const { alt, className, fill, width, height, style } = props;
  return (
    <svg
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      focusable="false"
      className={className}
      width={fill ? "100%" : width}
      height={fill ? "100%" : height}
      style={{ ...(fill ? { position: "absolute", inset: 0, width: "100%", height: "100%" } as const : {}), ...style }}
      data-part-image-layout="audited"
    >
      {alt && <title>{alt}</title>}
      <rect width="100%" height="100%" fill={layout.background} />
      {/* Keep content beyond the original 5.66% dark edge fade. */}
      <svg x="8%" y="8%" width="84%" height="84%" viewBox={layout.box.join(" ")} preserveAspectRatio="xMidYMid meet" overflow="hidden">
        <image href={props.src} width={layout.width} height={layout.height} />
      </svg>
    </svg>
  );
}
