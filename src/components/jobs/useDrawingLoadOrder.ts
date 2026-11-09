"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  drawingLinkSlow,
  noteDrawingImage,
  onDrawingLinkChange,
} from "~/lib/drawing-network";

const unknown = () => null;

/**
 * On a weak signal a sheet loads in steps: the small copy, then the sheet
 * image, then sharp PDF detail. Started together they share one thin pipe and
 * each arrives late. `holdDetail` keeps PDF reading back until the sheet image
 * is in, unless the connection is known to be good.
 */
export function useDrawingLoadOrder(
  src: string,
  image: RefObject<HTMLImageElement | null>,
  placeholder: RefObject<HTMLImageElement | null>,
) {
  const slow = useSyncExternalStore(
    onDrawingLinkChange,
    drawingLinkSlow,
    unknown,
  );
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const sheet = image.current;
    if (!sheet) return;
    const done = () => setSettled(src);
    const loaded = () => {
      noteDrawingImage(sheet);
      done();
    };
    if (sheet.complete && sheet.naturalWidth > 0) loaded();
    sheet.addEventListener("load", loaded);
    sheet.addEventListener("error", done);
    const small = placeholder.current;
    const smallLoaded = () => small && noteDrawingImage(small);
    if (small?.complete && small.naturalWidth > 0) smallLoaded();
    small?.addEventListener("load", smallLoaded);
    return () => {
      sheet.removeEventListener("load", loaded);
      sheet.removeEventListener("error", done);
      small?.removeEventListener("load", smallLoaded);
    };
  }, [src, image, placeholder]);
  return { slow: slow === true, holdDetail: settled !== src && slow !== false };
}
