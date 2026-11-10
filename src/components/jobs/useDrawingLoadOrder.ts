"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  drawingLinkFast,
  drawingLinkSlow,
  noteDrawingImage,
  onDrawingLinkChange,
} from "~/lib/drawing-network";

const unknown = () => null;
const notFast = () => false;

/** What the viewer knows about the sheet's PDF, for choosing the order. */
export type DrawingDetailPlan = {
  /** Still finding out where the sheet's PDF is read from. */
  pending: boolean;
  /** Saved PDF bytes need no network scheduling or preview-image gate. */
  localPdf?: boolean;
  /** Download sizes of the sheet's own PDF and of its image, when known. */
  pdfBytes?: number;
  imageBytes?: number | null;
  /** The sheet can be laid out and drawn before its image arrives. */
  imageMayWait: boolean;
  /** PDF detail has reached the screen, or failed. */
  detailDone: boolean;
  /** The person is looking closer than the sheet image can show. */
  zoomed?: boolean;
  /** The sheet has tiles, and whether those on screen have all arrived. */
  hasTiles?: boolean;
  tilesReady?: boolean;
};

/** A zoom this soon after opening finds little of the sheet image loaded. */
const EARLY_ZOOM_MS = 2500;
/** A sheet PDF this small arrives about as soon as the tiles on screen. */
const SMALL_PDF_BYTES = 192 * 1024;
/** The PDF is not kept back longer than this for tiles that do not come. */
const TILE_WAIT_MS = 15_000;

/** The sheet image is not kept back longer than this for a stuck PDF. */
const imageWaitMs = (pdfBytes: number) =>
  Math.max(20_000, (pdfBytes / (8 * 1024)) * 1000);

/**
 * On a weak signal a sheet loads in steps: the small copy, then whichever of
 * the sheet image and the sheet's own PDF is the smaller download, then the
 * other. Started together they share one thin pipe and each arrives late.
 * `holdDetail` keeps PDF reading back and `holdImage` keeps the sheet image
 * back. Neither holds once the connection is known to be good.
 *
 * Someone who zooms in as the sheet opens is no longer looking at the sheet
 * image, so it is not what they wait for: the tiles on screen load first,
 * then the PDF, and the image last. Until the PDF is in, only the tiles on
 * screen are asked for (`tiles` is "view") unless the link is fast.
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
  const fast = useSyncExternalStore(
    onDrawingLinkChange,
    drawingLinkFast,
    notFast,
  );
  const [settled, setSettled] = useState<string | null>(null);
  const [late, setLate] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setLate(src), EARLY_ZOOM_MS);
    return () => clearTimeout(timer);
  }, [src]);
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
  // Zoomed in while the sheet image had barely started: remembered for the
  // sheet, so zooming back out does not restart the order.
  const [early, setEarly] = useState<string | null>(null);
  const canWait = Boolean(plan?.imageMayWait);
  if (
    plan?.zoomed &&
    canWait &&
    !plan.localPdf &&
    late !== src &&
    settled !== src &&
    early !== src
  )
    setEarly(src);
  // On any link: a fast one loses a round trip, a middling one stops
  // splitting itself between what is on screen and what is not.
  const zoomFirst =
    early === src && canWait && !plan?.detailDone && released !== src;
  const waiting =
    (detailFirst || zoomFirst) && !plan?.detailDone && released !== src;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setReleased(src), imageWaitMs(pdfBytes));
    return () => clearTimeout(timer);
  }, [waiting, src, pdfBytes]);
  // Tiles on screen are a few small files; a larger PDF waits for them.
  const tilesLead =
    zoomFirst &&
    !pending &&
    Boolean(plan?.hasTiles) &&
    !(pdfBytes > 0 && pdfBytes <= SMALL_PDF_BYTES);
  const [tilesLed, setTilesLed] = useState<string | null>(null);
  if (tilesLead && plan?.tilesReady && tilesLed !== src) setTilesLed(src);
  // On a fast link the PDF starts beside them.
  const tilesHold =
    tilesLead && !fast && Boolean(plan?.zoomed) && tilesLed !== src;
  useEffect(() => {
    if (!tilesHold) return;
    const timer = setTimeout(() => setTilesLed(src), TILE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [tilesHold, src]);

  const holdImage =
    !plan?.localPdf && ((mayWait && pending && released !== src) || waiting);
  // With the PDF still to come, tiles around the view and the coarser
  // fallback under it would only take the link from it.
  const fewTiles =
    tilesLead || (canWait && !fast && !pending && !plan?.detailDone);
  return {
    slow: slow === true,
    /** Tiles wait for the view to hold still: a passing pinch frame is not
     * worth a download unless the link is fast. */
    restTiles: !fast,
    holdDetail:
      !plan?.localPdf &&
      (pending ||
        tilesHold ||
        (!detailFirst &&
          // Once ahead of the image, the PDF stays ahead: panning after it
          // is sharp must not wait for the image either.
          !(early === src && canWait) &&
          settled !== src &&
          !good &&
          released !== src)),
    holdImage,
    /** Which tiles may load: all, only those on screen, or none for now. */
    tiles: plan?.localPdf
      ? ("all" as const)
      : holdImage && !tilesLead
        ? ("none" as const)
        : fewTiles
          ? ("view" as const)
          : ("all" as const),
  };
}
