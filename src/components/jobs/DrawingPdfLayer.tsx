"use client";
import { requestPageAnimationFrame as requestAnimationFrame, cancelPageAnimationFrame as cancelAnimationFrame } from "~/lib/app-page-activity";


import {
  completedPdfBounds,
  rememberPdfBounds,
  preparePdfBounds,
} from "~/lib/drawing-pdf-bounds";

import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type RefCallback,
  type RefObject,
} from "react";
import {
  canRasterDrawingOffThread,
  drawingPdfRaster,
  isRasterCancel,
} from "~/lib/drawing-pdf-raster-client";
import {
  drawingPdfOperationsFilter,
  isFullDrawingPatch,
} from "~/lib/drawing-pdf-operations";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { discardPdfDocument, loadPdfDocument } from "~/lib/pdf-client";
import { recordDrawingPerformance } from "~/lib/drawing-performance";
import { createDrawingRenderStrain } from "~/lib/drawing-render-strain";
import {
  drawingPatchRect,
  drawingPatchSharpness,
  drawingPatchStackCoverage,
  drawingViewLead,
  keepDrawingPatchDuringPan,
  MAX_DRAWING_PATCH_PIXELS,
  patchCoversView,
  patchScreenCoverage,
  planDrawingPatch,
  planDrawingStrip,
  shiftDrawingView,
  stretchDrawingLead,
  type DrawingCameraSample,
  type DrawingLead,
  type DrawingPatch,
  type DrawingSize,
  type DrawingView,
} from "~/lib/drawing-viewport";

type Props = {
  pdf: { url: string; page: number };
  onReady?: () => void;
  onError?: (error: unknown) => void;
  fit: DrawingSize;
  frameSize: DrawingSize;
  view: DrawingView;
  dpr: number;
  enabled: boolean;
  /** Weak signal: the sheet image loads first, so read no PDF bytes yet. */
  hold?: boolean;
  moving: boolean;
  /** Render outside the CSS-scaled sheet to preserve canvas pixels on Safari. */
  screenSpace?: boolean;
  appearanceFilter?: string;
  paintRef?: RefObject<((view: DrawingView) => void) | null>;
  /** The scales the camera can reach, so detail is not drawn beyond them. */
  zoom?: { min: number; max: number };
};
type Snapshot = { index: number; patch: DrawingPatch; scale: number };
/** Pages the background renderer could not draw stay on the main thread. */
const mainThreadPages = new Set<string>();
/** Frames between a finished bitmap and it reaching the screen. */
const HANDOFF_MS = 33;
/** Whether this device misses frames while detail is drawn during motion. */
const strain = createDrawingRenderStrain();
/** Background detail canvases: a pan lays strips beside the detail it has. */
const DETAIL_SLOTS = 6;
/** Detail showing at once stays within two whole patches' pixels. */
const MAX_SHOWN_PIXELS = 2 * MAX_DRAWING_PATCH_PIXELS;
/** A pan asks for its next strip this much sooner than it expects to need it. */
const PAN_SLACK = 1.5;
/**
 * Double-buffered, overscanned PDF detail. Primary drawings use screen-space
 * placement so a CSS-scaled ancestor cannot flatten their high-resolution ink.
 * Comparison callers can still use sheet-relative placement.
 * Motion never erases it or cancels useful work; only changing sheets does.
 * Off the main thread several buffers can show at once: the denser patch on
 * top, the others filling in where it does not reach. A pan draws only the
 * strip of sheet it is moving into, beside the detail already showing.
 */
export function DrawingPdfLayer(props: Props) {
  // Detail is drawn by a background worker where the browser allows it; the
  // main-thread renderer remains for older browsers and pages it cannot draw.
  const pageKey = `${props.pdf.page}:${props.pdf.url}`;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const offThread =
    !mainThreadPages.has(pageKey) && canRasterDrawingOffThread();
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);
  const latest = useRef(props);
  latest.current = props;
  const request = useRef<() => void>(() => undefined);
  const patches = useRef<Array<DrawingPatch | null>>(
    Array<DrawingPatch | null>(DETAIL_SLOTS).fill(null),
  );
  const camera = useRef(props.view);
  // Recent live camera positions, used to draw detail where a pan is heading.
  const motion = useRef<DrawingCameraSample[]>([]);
  const follow = useRef<() => void>(() => undefined);
  const position = (index: number, view: DrawingView) => {
    const canvas = canvases.current[index];
    const patch = patches.current[index];
    if (!canvas || !patch) return;
    const p = latest.current;
    const width = p.fit.width * view.scale;
    const height = p.fit.height * view.scale;
    Object.assign(
      canvas.style,
      p.screenSpace
        ? {
            left: "0px",
            top: "0px",
            transform: `translate3d(${(p.frameSize.width - width) / 2 + view.x + patch.left * width}px, ${(p.frameSize.height - height) / 2 + view.y + patch.top * height}px, 0)`,
            willChange: "transform",
            width: `${patch.width * width}px`,
            height: `${patch.height * height}px`,
          }
        : {
            transform: "",
            willChange: "auto",
            left: `${patch.left * 100}%`,
            top: `${patch.top * 100}%`,
            width: `${patch.width * 100}%`,
            height: `${patch.height * 100}%`,
          },
    );
  };
  useLayoutEffect(() => {
    const paint = (view: DrawingView) => {
      camera.current = view;
      canvases.current.forEach((_, index) => position(index, view));
    };
    paint(props.view);
    if (props.paintRef)
      props.paintRef.current = (view) => {
        // The frame's own time, the same for every callback in that frame.
        const frameTime = document.timeline?.currentTime;
        const at = typeof frameTime === "number" ? frameTime : performance.now();
        const samples = motion.current;
        samples.push({ ...view, at });
        while (samples.length > 2 && at - samples[0]!.at > 150) samples.shift();
        paint(view);
        follow.current();
      };
    return () => {
      if (props.paintRef) props.paintRef.current = null;
    };
  });

  useEffect(() => {
    const buffers = [...canvases.current];
    let disposed = false;
    let rendering = false;
    let stopPreparation: (() => void) | undefined;
    let current: Snapshot | null = null;
    let task: { cancel: () => void } | null = null;
    let inflight: { patch: DrawingPatch; cancel: () => void } | null = null;
    // Set when this layer drops a render the camera has moved away from.
    let superseded = false;
    let shownAt = Number.NEGATIVE_INFINITY;
    let watching: number | null = null;
    // Typical time for a background render to reach the screen.
    let expectedMs = 120;
    const raster = offThread ? drawingPdfRaster() : null;
    if (offThread && !raster) {
      rerender();
      return;
    }
    const release = raster?.acquire();
    const slots = raster ? DETAIL_SLOTS : 2;
    // When each buffer last took a patch; older detail retires first.
    const placed = Array<number>(DETAIL_SLOTS).fill(0);
    let placements = 0;
    patches.current.fill(null);
    // Bitmap canvases let go of their pixels through their own context. A null
    // transfer makes a blank bitmap the canvas's size, which at full size held
    // the main thread for about a frame on every detail swap; empty it first.
    const free = (canvas: HTMLCanvasElement) => {
      canvas.width = 0;
      canvas.height = 0;
      if (raster) canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(null);
    };
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAfter = 0;
    let stalledTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let viewRequestedAt = performance.now();
    let requestedView = "";
    const source = { ...props.pdf };
    for (const canvas of buffers) {
      if (canvas) {
        canvas.style.visibility = "hidden";
        free(canvas);
      }
    }

    // Prepare the current page after the initial image has painted. Byte-range
    // loading keeps this to needed PDF objects, avoiding a cold worker/page
    // lookup the first time the user zooms beyond the pre-rendered tiles.
    const warm = () => {
      // Held back for the sheet image: drawing opens it afterwards.
      if (disposed || latest.current.hold) return;
      if (raster) return raster.warm(source.url, source.page);
      void loadPdfDocument(source.url)
        .then((document) =>
          disposed ? undefined : document.getPage(source.page),
        )
        .catch(() => undefined);
    };
    const idle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(warm, { timeout: 2000 })
        : null;
    const warmTimer = idle === null ? setTimeout(warm, 500) : null;

    // Off the main thread, detail follows the live camera and is drawn where
    // the view is heading. The main-thread renderer keeps to settled views.
    const viewNow = () => (raster ? camera.current : latest.current.view);
    const careful = () => !raster || strain.strained;
    const leadNow = () => {
      if (!latest.current.moving || careful()) return null;
      const lead = drawingViewLead(
        motion.current,
        latest.current.fit,
        performance.now(),
        expectedMs + HANDOFF_MS,
        latest.current.zoom,
      );
      // A pan's next strip is small; asking a little early lets it land
      // before the edge of the detail reaches the screen.
      return lead && lead.zoom === 1
        ? { ...lead, x: lead.x * PAN_SLACK, y: lead.y * PAN_SLACK }
        : lead;
    };
    const covers = (patch: DrawingPatch, view: DrawingView) => {
      const { fit, frameSize, dpr } = latest.current;
      return patchCoversView(patch, fit, frameSize, view, dpr);
    };
    const shownPatches = () =>
      patches.current.filter((patch): patch is DrawingPatch => !!patch);
    const sharpness = (stack: readonly DrawingPatch[], view: DrawingView) => {
      const { fit, frameSize, dpr } = latest.current;
      return drawingPatchSharpness(stack, fit, frameSize, view, dpr);
    };
    const pixelsIn = (stack: readonly DrawingPatch[]) =>
      stack.reduce((sum, patch) => sum + patch.pixelWidth * patch.pixelHeight, 0);
    const needsDetail = (view: DrawingView, lead: DrawingLead | null) => {
      if (!current) return true;
      if (lead) {
        // In motion, what counts is the screen when a render started now
        // could arrive: sharp where the camera is heading, and nothing
        // missing on the way there. Detail leaving the screen behind a pan
        // sooner than any render could land is not worth drawing again.
        const { fit, frameSize } = latest.current;
        const stack = shownPatches();
        const soon = HANDOFF_MS / ((expectedMs + HANDOFF_MS) * PAN_SLACK);
        const way =
          lead.zoom === 1
            ? shiftDrawingView(view, fit, { x: lead.x * soon, y: lead.y * soon, zoom: 1 })
            : view;
        return !(
          sharpness(stack, shiftDrawingView(view, fit, lead)) >= 0.9999 &&
          drawingPatchStackCoverage(stack, fit, frameSize, way) >= 0.9999
        );
      }
      // Background detail counts together: strips laid beside each other
      // show the view as well as one patch would.
      if (raster ? sharpness(shownPatches(), view) >= 0.9999 : covers(current.patch, view))
        return false;
      // A small pan should move the existing bitmap, not start another large
      // PDF raster on the same thread as touch input, or on a device that
      // misses frames for each new one. Refill during a long pan only when
      // most of that bitmap has left the screen; settling always requests
      // full detail immediately.
      const p = latest.current;
      return !(
        careful() &&
        keepDrawingPatchDuringPan(current.patch, current.scale, p.fit,
          p.frameSize, view, p.moving)
      );
    };
    // How sharp a stack of patches makes the screen at `at`, the camera now
    // unless judged for a render still to land, and where it is heading.
    const worth = (stack: Array<DrawingPatch | null | undefined>, at = camera.current) => {
      const { fit } = latest.current;
      const shown = stack.filter((patch): patch is DrawingPatch => !!patch);
      const lead = leadNow();
      return sharpness(shown, at) + sharpness(shown, lead ? shiftDrawingView(at, fit, lead) : at);
    };
    // Where the camera is expected to be when a render started now lands.
    const landing = (view: DrawingView) => {
      if (!leadNow()) return view;
      const { fit, zoom } = latest.current;
      const lead = drawingViewLead(motion.current, fit, performance.now(), expectedMs, zoom);
      return lead ? shiftDrawingView(view, fit, lead) : view;
    };
    // Shown slots, oldest first.
    const byAge = () =>
      patches.current
        .map((patch, slot) => (patch ? slot : -1))
        .filter((slot) => slot >= 0)
        .sort((a, b) => placed[a]! - placed[b]!);
    // The buffer a finished background patch goes in and the detail it
    // retires to stay within the buffers and the pixel cap, or null when
    // keeping what is on screen is better. What retires is what the screen
    // misses least, the oldest on a tie.
    const place = (patch: DrawingPatch, at = camera.current) => {
      if (!(worth([patch], at) > 0)) return null;
      const kept = byAge();
      const drop: number[] = [];
      const beside = (chosen: number[]) => [
        patch,
        ...chosen.map((slot) => patches.current[slot]!),
      ];
      while (kept.length && (kept.length >= slots || pixelsIn(beside(kept)) > MAX_SHOWN_PIXELS)) {
        let least = 0,
          value = Number.NEGATIVE_INFINITY;
        kept.forEach((_, i) => {
          const without = worth(beside(kept.filter((__, k) => k !== i)), at);
          if (without > value + 1e-6) {
            least = i;
            value = without;
          }
        });
        drop.push(...kept.splice(least, 1));
      }
      const gain = worth(beside(kept), at) - worth(patches.current, at);
      if (!(gain + 1e-6 >= 0)) return null;
      const slot =
        drop[0] ?? patches.current.findIndex((shown, index) => index < slots && !shown);
      return slot < 0 ? null : { slot, drop, gain };
    };
    const retire = (slot: number) => {
      const canvas = buffers[slot];
      if (canvas) {
        canvas.style.visibility = "hidden";
        free(canvas);
      }
      patches.current[slot] = null;
    };
    // Earlier detail goes once the rest shows all it did. On a device that
    // misses frames for each bitmap that is what shows now, without looking
    // ahead; what is still on screen stays until newer detail covers it.
    const prune = () => {
      if (!current) return;
      for (const slot of byAge()) {
        if (slot === current.index) continue;
        const without = patches.current.map((patch, index) => (index === slot ? null : patch));
        if (worth(without) + 1e-6 >= worth(patches.current)) retire(slot);
      }
    };
    // Denser detail on top, the newest on a tie: the order sharpness assumes.
    const restack = () => {
      byAge()
        .sort((a, b) => patches.current[a]!.fullWidth - patches.current[b]!.fullWidth)
        .forEach((slot, rank) => {
          const canvas = buffers[slot];
          if (canvas) canvas.style.zIndex = String(rank + 1);
        });
    };
    // A pan draws only the strip of sheet it is moving into, on the pixel grid
    // of the detail beside it, so each render is small and lands in time. It
    // reaches past where the camera is expected, so a few strips cover a
    // screen. A zoom, or a view with no detail at its density yet, draws it
    // whole.
    // Returns what is worth drawing, best first.
    const planDetail = (view: DrawingView, lead: DrawingLead | null) => {
      const { fit, frameSize, dpr } = latest.current;
      const whole = planDrawingPatch(fit, frameSize, view, dpr, lead);
      if (!whole || careful()) return whole ? [whole] : [];
      const reach = lead && stretchDrawingLead(lead, fit, frameSize, view.scale);
      if (lead && !reach && lead.zoom !== 1) return [whole];
      const here = planDrawingPatch(fit, frameSize, view, dpr);
      const there = reach && planDrawingPatch(fit, frameSize, shiftDrawingView(view, fit, reach), dpr);
      if (!here) return [whole];
      const area = drawingPatchRect(here);
      if (there) {
        const far = drawingPatchRect(there);
        area.left = Math.min(area.left, far.left);
        area.top = Math.min(area.top, far.top);
        area.right = Math.max(area.right, far.right);
        area.bottom = Math.max(area.bottom, far.bottom);
      }
      // Scored where placing it is judged: now and where the camera is heading.
      const views = lead ? [view, shiftDrawingView(view, fit, lead)] : [view];
      const strip = planDrawingStrip(here, area, shownPatches(), fit, frameSize, views, dpr);
      return strip ? [strip, whole] : [whole];
    };
    const schedule = (delay = 0) => {
      if (disposed || rendering || nextTimer !== null) return;
      nextTimer = setTimeout(() => {
        nextTimer = null;
        void draw();
      }, delay);
    };
    const draw = async () => {
      if (disposed || rendering) return;
      const start = latest.current;
      if (
        !start.enabled ||
        start.hold ||
        document.visibilityState === "hidden" ||
        Date.now() < retryAfter
      )
        return;
      const view = viewNow();
      if (!planDrawingPatch(start.fit, start.frameSize, view, start.dpr)) return;
      const lead = leadNow();
      if (!needsDetail(view, lead)) return;
      const index = current?.index === 0 ? 1 : 0;
      const canvas = buffers[index];
      if (!canvas) return;
      // Background detail is drawn only if it would show something new in
      // the buffers there are, now or as it will be when it lands; a strip
      // with no room gives way to the whole view. Anything else would be
      // drawn again and again while the camera heads somewhere detail
      // cannot reach yet, or thrown away on arrival.
      const at = landing(view);
      const gain = (patch: DrawingPatch) =>
        Math.max(place(patch)?.gain ?? 0, at === view ? 0 : (place(patch, at)?.gain ?? 0));
      const planned = raster ? planDetail(view, lead).find((patch) => gain(patch) > 1e-6) : null;
      if (raster && !planned) return;
      rendering = true;
      superseded = false;
      let renderedScale = view.scale;
      const loadingAt = performance.now();
      let renderingAt = loadingAt;
      let pixels = 0;
      let tookMs = 0;
      let bitmap: ImageBitmap | null = null;
      try {
        let ready = latest.current;
        let patch: DrawingPatch | null;
        let page: PDFPageProxy | null = null;
        if (raster) {
          patch = planned ?? null;
          if (!patch) return;
          pixels = patch.pixelWidth * patch.pixelHeight;
          const job = raster.render(source.url, source.page, patch);
          task = job;
          inflight = { patch, cancel: job.cancel };
          stalledTimer = setTimeout(job.cancel, 30_000);
          ({ bitmap } = await job.promise);
          if (disposed) return;
          tookMs = performance.now() - loadingAt;
        } else {
          const loading = loadPdfDocument(source.url);
          page = await Promise.race([
            loading.then((document) =>
              disposed ? null : document.getPage(source.page),
            ),
            new Promise<never>((_, reject) => {
              stalledTimer = setTimeout(() => {
                discardPdfDocument(source.url, loading);
                reject(new Error("Drawing PDF loading timed out"));
              }, 30_000);
            }),
          ]);
          if (stalledTimer !== null) clearTimeout(stalledTimer);
          stalledTimer = null;
          if (disposed || !page) return;
          // Loading a cold document may outlast a whole gesture. Rasterize the
          // newest view, not the one captured before the network/worker wait.
          ready = latest.current;
          if (!ready.enabled) return;
          renderedScale = ready.view.scale;
          patch = planDrawingPatch(
            ready.fit,
            ready.frameSize,
            ready.view,
            ready.dpr,
          );
          if (!patch) return;
          const raw = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: patch.fullWidth / raw.width,
          });
          canvas.style.visibility = "hidden";
          canvas.width = patch.pixelWidth;
          canvas.height = patch.pixelHeight;
          pixels = canvas.width * canvas.height;
          renderingAt = performance.now();
          const bounds = completedPdfBounds(page);
          const recordFullPage = !bounds && isFullDrawingPatch(patch);
          if (recordFullPage) page.recordedBBoxes = null;
          const render = page.render({
            canvas,
            viewport,
            // Recording while the whole page is visible lets later crops skip
            // offscreen ink and its unused state. Deep-link opens without a full
            // recording retain the complete rendering path.
            recordOperations: recordFullPage,
            operationsFilter: drawingPdfOperationsFilter(bounds, patch),
            transform: [
              1,
              0,
              0,
              patch.fullHeight / viewport.height,
              -patch.left * patch.fullWidth,
              -patch.top * patch.fullHeight,
            ],
          });
          task = render;
          // A stuck PDF task must not block all future zoom/detail requests.
          stalledTimer = setTimeout(() => render.cancel(), 30_000);
          // Display rendering in the installed PDF.js already yields via RAF.
          // Keep that scheduler instead of adding another frame of latency.
          await render.promise;
          if (stalledTimer !== null) clearTimeout(stalledTimer);
          stalledTimer = null;
          if (disposed) return;
          if (recordFullPage) rememberPdfBounds(page);
        }
        const now = latest.current;
        const nowView = viewNow();
        let shown = false;
        if (bitmap) {
          const placement = place(patch);
          const target = placement && buffers[placement.slot];
          if (placement && target) {
            const { slot } = placement;
            for (const old of placement.drop) if (old !== slot) retire(old);
            // Handing the worker's bitmap to the canvas moves it; no pixels are
            // copied. The size keeps toDataURL (markup snapshots) working.
            target.width = bitmap.width;
            target.height = bitmap.height;
            target.getContext("bitmaprenderer")?.transferFromImageBitmap(bitmap);
            bitmap = null;
            patches.current[slot] = patch;
            placed[slot] = ++placements;
            shownAt = performance.now();
            position(slot, camera.current);
            target.style.visibility = "visible";
            current = { index: slot, patch, scale: renderedScale };
            prune();
            restack();
            shown = true;
            latest.current.onReady?.();
          }
          // Placed by the horizon it was drawn for, so a render that came
          // early counts as in time rather than too far ahead.
          expectedMs = expectedMs * 0.6 + tookMs * 0.4;
        } else {
          const coverage = patchScreenCoverage(
            patch,
            now.fit,
            now.frameSize,
            nowView,
          );
          const oldCoverage = current
            ? patchScreenCoverage(current.patch, now.fit, now.frameSize, nowView)
            : 0;
          // A render can finish after a fast fling. Do not replace good detail
          // with an obsolete patch covering less of the view; refill the latest.
          if (coverage > 0 && (coverage + 0.001 >= oldCoverage || !current)) {
            patches.current[index] = patch;
            shownAt = performance.now();
            position(index, camera.current);
            canvas.style.visibility = "visible";
            if (current) {
              const previous = buffers[current.index];
              if (previous) {
                previous.style.visibility = "hidden";
                // Safari retains hidden canvas backing stores. Free the old
                // bitmap only after the replacement is ready and visible.
                free(previous);
                patches.current[current.index] = null;
              }
            }
            current = { index, patch, scale: renderedScale };
            shown = true;
            latest.current.onReady?.();
          }
        }
        const sharp =
          shown &&
          (raster
            ? sharpness(shownPatches(), nowView) >= 0.9999
            : patchCoversView(patch, now.fit, now.frameSize, nowView, now.dpr));
        recordDrawingPerformance({
          loadMs: renderingAt - loadingAt,
          renderMs: performance.now() - renderingAt,
          viewToSharpMs: sharp ? performance.now() - viewRequestedAt : null,
          pixels,
          outcome: sharp ? "sharp" : "partial",
        });
        if (page && !stopPreparation && !completedPdfBounds(page)) {
          stopPreparation = preparePdfBounds(
            page,
            () => request.current(),
            () => !disposed && latest.current.enabled && !latest.current.moving,
          );
        }
        retryAfter = 0;
        failures = 0;
      } catch (error) {
        // Superseded by a newer view; the next draw starts straight away.
        if (raster && !disposed && superseded && isRasterCancel(error)) return;
        // The background renderer could not draw this page. Draw it here.
        if (raster && !disposed) {
          disposed = true;
          mainThreadPages.add(pageKey);
          rerender();
          return;
        }
        if (!disposed) latest.current.onError?.(error);
        if (!disposed)
          recordDrawingPerformance({
            loadMs: renderingAt - loadingAt,
            renderMs: performance.now() - renderingAt,
            viewToSharpMs: null,
            pixels,
            outcome: "failed",
          });
        // Preserve the existing sharp patch/tiles through transient failures.
        // After the quick retries, keep a low-frequency recovery attempt while
        // visible. A stationary drawing must not remain blurry indefinitely.
        failures++;
        retryAfter = Date.now() + (failures >= 4 ? 60_000 : 3000 * failures);
      } finally {
        if (stalledTimer !== null) clearTimeout(stalledTimer);
        stalledTimer = null;
        // Failed and obsolete work must not retain a second large bitmap.
        // A background render never touched its canvas, which may be showing.
        bitmap?.close();
        if (!raster && !disposed && current?.index !== index) free(canvas);
        task = null;
        inflight = null;
        rendering = false;
        if (!disposed) schedule(Math.max(0, retryAfter - Date.now()));
      }
    };
    // Every frame of a gesture, so a frame with no camera change is not
    // mistaken for a missed one. A new bitmap is composited the frame after.
    const watch = (time: number) => {
      watching = null;
      if (disposed || !latest.current.moving) return;
      strain.frame(time, rendering || time - shownAt < 50);
      watching = requestAnimationFrame(watch);
    };
    follow.current = () => {
      if (!raster || disposed || rendering || nextTimer !== null || !current) return;
      if (!latest.current.enabled) return;
      if (needsDetail(camera.current, leadNow()))
        schedule(Math.max(0, retryAfter - Date.now()));
    };
    request.current = () => {
      const p = latest.current;
      if (raster && p.moving && watching === null)
        watching = requestAnimationFrame(watch);
      // A render planned for a view the gesture has left would only delay the
      // one for where it came to rest; one that finishes that view stays.
      const shown = shownPatches();
      if (
        inflight &&
        !p.moving &&
        !(
          sharpness(shown, camera.current) < 0.9999 &&
          sharpness([...shown, inflight.patch], camera.current) >= 0.9999
        )
      ) {
        superseded = true;
        inflight.cancel();
      }
      if (raster && !p.moving) prune();
      const key = `${p.view.scale}:${p.view.x}:${p.view.y}:${p.frameSize.width}:${p.frameSize.height}:${p.fit.width}:${p.fit.height}:${p.dpr}:${p.moving}`;
      if (key !== requestedView) {
        // A fresh settled view gets an immediate retry after a transient failure.
        if (!p.moving && failures > 0) {
          failures = 0;
          retryAfter = 0;
          if (nextTimer !== null) clearTimeout(nextTimer);
          nextTimer = null;
        }
        requestedView = key;
        viewRequestedAt = performance.now();
      }
      schedule(Math.max(0, retryAfter - Date.now()));
    };
    const resume = () => {
      if (document.visibilityState === "hidden") return;
      failures = 0;
      retryAfter = 0;
      if (nextTimer !== null) clearTimeout(nextTimer);
      nextTimer = null;
      schedule();
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    schedule();
    return () => {
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      if (stalledTimer !== null) clearTimeout(stalledTimer);
      disposed = true;
      request.current = () => undefined;
      follow.current = () => undefined;
      if (watching !== null) cancelAnimationFrame(watching);
      task?.cancel();
      stopPreparation?.();
      if (nextTimer !== null) clearTimeout(nextTimer);
      if (idle !== null) window.cancelIdleCallback(idle);
      if (warmTimer !== null) clearTimeout(warmTimer);
      for (const canvas of buffers) {
        if (canvas) {
          canvas.style.visibility = "hidden";
          free(canvas);
        }
      }
      release?.();
    };
    // Geometry changes request a refill below; only a different source tears down buffers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pdf.url, props.pdf.page, offThread]);

  useEffect(() => {
    request.current();
  }, [
    props.view,
    props.fit,
    props.frameSize,
    props.dpr,
    props.enabled,
    props.hold,
    props.moving,
  ]);
  const bind =
    (index: number): RefCallback<HTMLCanvasElement> =>
    (canvas) => {
      canvases.current[index] = canvas;
    };
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        display: props.enabled ? undefined : "none",
        zIndex: 1,
        filter: props.appearanceFilter,
        overflow: props.screenSpace ? "hidden" : undefined,
      }}
    >
      {Array.from({ length: offThread ? DETAIL_SLOTS : 2 }, (_, index) => (
        <canvas
          // A canvas keeps its first context type; switching renderer needs new ones.
          key={`${offThread ? "bitmap" : "2d"}-${index}`}
          ref={bind(index)}
          data-pdf-detail=""
          className="absolute"
          style={{ visibility: "hidden" }}
        />
      ))}
    </div>
  );
}
