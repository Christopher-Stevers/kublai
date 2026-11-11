"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useState } from "react";
import {
  cachedPartImageLayouts,
  loadPartImageLayouts,
  isCatalogueImageSource,
} from "~/lib/part-image-layout-resource";

/** Reversible framing of audited product photos. The original pixels stay intact.
 * A matching background fills letterboxing; only verified empty margins are hidden.
 * SVG viewBox works on Safari too, unlike CSS object-view-box.
 */
export default function PartImage(props: ImageProps) {
  const key =
    typeof props.src === "string"
      ? props.src
      : "src" in props.src
        ? props.src.src
        : props.src.default.src;
  return <PartImageContent key={key} {...props} />;
}

function PartImageContent(props: ImageProps) {
  const source = typeof props.src === "string" ? props.src : "";
  const relevant = isCatalogueImageSource(source);
  const [result, setResult] = useState<{
    source: string;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    if (!relevant || cachedPartImageLayouts()) return;
    let current = true;
    void loadPartImageLayouts().then(
      () => {
        if (current) setResult({ source, failed: false });
      },
      () => {
        if (current) setResult({ source, failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, [source, relevant]);
  // A displayed failure fallback never later jumps into an audited crop.
  const failed = result?.source === source && result.failed;
  const audited = failed ? undefined : cachedPartImageLayouts();
  const pending = relevant && !failed && !audited;
  const layout = relevant ? audited?.[source] : undefined;
  if (pending) {
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
        style={{
          ...(fill
            ? ({
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
              } as const)
            : {}),
          ...style,
        }}
        data-part-image-layout="pending"
      >
        {alt && <title>{alt}</title>}
      </svg>
    );
  }
  if (!layout?.background || typeof props.src !== "string")
    return <Image {...props} alt={props.alt} />;
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
      style={{
        ...(fill
          ? ({
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            } as const)
          : {}),
        ...style,
      }}
      data-part-image-layout="audited"
    >
      {alt && <title>{alt}</title>}
      <rect width="100%" height="100%" fill={layout.background} />
      {/* Keep content beyond the original 5.66% dark edge fade. */}
      <svg
        x="8%"
        y="8%"
        width="84%"
        height="84%"
        viewBox={layout.box.join(" ")}
        preserveAspectRatio="xMidYMid meet"
        overflow="hidden"
      >
        <image href={props.src} width={layout.width} height={layout.height} />
      </svg>
    </svg>
  );
}
