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

/** What the viewer knows about the sheet's PDF, for choosing the order. */
export type DrawingDetailPlan = {
  /** Still finding out where the sheet's PDF is read from. */
  pending: boolean;
  /** Download sizes of the sheet's own PDF and of its image, when known. */
  pdfBytes?: number;
  imageBytes?: number | null;
  /** The sheet can be laid out and drawn before its image arrives. */
  imageMayWait: boolean;
  /** PDF detail has reached the screen, or failed. */
  detailDone: boolean;
};

/** The sheet image is not kept back longer than this for a stuck PDF. */
const imageWaitMs = (pdfBytes: number) =>
  Math.max(20_000, (pdfBytes / (8 * 1024)) * 1000);

/**
 * On a weak signal a sheet loads in steps: the small copy, then whichever of
 * the sheet image and the sheet's own PDF is the smaller download, then the
 * other. Started together they share one thin pipe and each arrives late.
 * `holdDetail` keeps PDF reading back and `holdImage` keeps the sheet image
 * back. Neither holds once the connection is known to be good.
 */
export function useDrawingLoadOrder(
  src: string,
  image: RefObject<HTMLImageElement | null>,
  placeholder: RefObject<HTMLImageElement | null>,
  plan?: DrawingDetailPlan,
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

  const good = slow === false;
  const pending = Boolean(plan?.pending);
  const pdfBytes = plan?.pdfBytes ?? 0;
  const imageBytes = plan?.imageBytes ?? 0;
  const mayWait = Boolean(plan?.imageMayWait) && !good;
  // The sheet's own PDF is the smaller download: it goes first, and the
  // sheet is sharp before its image has started.
  const detailFirst =
    mayWait && !pending && pdfBytes > 0 && pdfBytes < imageBytes;
  // A stuck PDF does not keep the image back for good.
  const [released, setReleased] = useState<string | null>(null);
  const waiting = detailFirst && !plan?.detailDone && released !== src;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setReleased(src), imageWaitMs(pdfBytes));
    return () => clearTimeout(timer);
  }, [waiting, src, pdfBytes]);

  return {
    slow: slow === true,
    holdDetail:
      pending || (!detailFirst && settled !== src && !good && released !== src),
    holdImage: (mayWait && pending && released !== src) || waiting,
  };
}
