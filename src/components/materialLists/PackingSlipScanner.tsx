"use client";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CameraIcon,
  FlashlightIcon,
  CheckIcon,
  CropIcon,
  FilePlus2Icon,
  RefreshCwIcon,
  RotateCcwIcon,
  Undo2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { SwitchTrack } from "~/components/ui/switch";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import {
  averageQuad,
  BLURRY,
  cornerShift,
  detectPage,
  grabFrame,
  locatePage,
  pageBlur,
  rectifyPage,
  scanPdf,
  toJpeg,
  type Pixels,
  type Quad,
} from "~/lib/scanning/page";
import { list, scanCount, scanCountMessage } from "~/lib/slip-pages";

/** Long side of the preview frames searched for the page. */
const PREVIEW = 480;
/** Matching outlines in a row before an automatic capture (about half a second). */
const STEADY = 4;
/** Outlines closer than this, in frame fractions, count as the same position. */
const SAME_PLACE = 0.02;
/** Further frames tried when a capture is blurry, keeping the sharpest. */
const RETRIES = 2;
/** Outline used when capturing by hand without a detected page. */
const WHOLE_FRAME: Quad = [
  { x: 0.06, y: 0.06 },
  { x: 0.94, y: 0.06 },
  { x: 0.94, y: 0.94 },
  { x: 0.06, y: 0.94 },
];

/** The last capture, kept until the next one so its corners can be adjusted. */
type Shot = { frame: Pixels; preview: string; quad: Quad };

function Outline({ quad, locked }: { quad: Quad; locked: boolean }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <polygon
        points={quad.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
        fill={locked ? "rgba(74,222,128,.2)" : "rgba(250,204,21,.1)"}
        stroke={locked ? "#4ade80" : "#facc15"}
        strokeWidth="3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function PackingSlipScanner({
  onSave,
  onCancel,
  onUpload,
  documentKind = "packing slip",
  actionBar,
  extraActions,
  pageAction,
  jobId,
}: {
  onSave: (file: File) => Promise<boolean>;
  onCancel: () => void;
  /** Choose a saved photo or PDF instead, e.g. on a computer without a camera. */
  onUpload?: () => void;
  /** Reuse camera capture for ordinary job documents. */
  documentKind?: "packing slip" | "document";
  /** Full-page use: the scanner's buttons go into this bottom bar instead
   * of under the camera. */
  actionBar?: HTMLElement | null;
  /** Lowest-priority actions of the page, shown in the same bar. */
  extraActions?: ReactNode;
  /** Full-page use: a way to another page, second to Capture while the
   * camera is up and low in the other modes. It
   * calls `leave()` first, which asks before unsaved pages are lost. */
  pageAction?: (leave: () => boolean) => ReactNode;
  /** A packing slip for this job: each captured page is read for its
   * printed page number, so the scan can say which pages are still to go. */
  jobId?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [pages, setPages] = useState<string[]>([]),
    [mode, setMode] = useState<
      "camera" | "review" | "adjust" | "saving" | "saved"
    >("camera");
  const [message, setMessage] = useState("Starting camera…"),
    [error, setError] = useState(""),
    [quad, setQuad] = useState<Quad | null>(null),
    [locked, setLocked] = useState(false),
    [ready, setReady] = useState(false),
    [restart, setRestart] = useState(0);
  const [light, setLight] = useState(""),
    [processing, setProcessing] = useState(false);
  const [autoLight, setAutoLight] = useState(true);
  const [lightOn, setLightOn] = useState(false);
  const [lightSupported, setLightSupported] = useState(false);
  const [lightBusy, setLightBusy] = useState(false);
  const lightPreference = useRef({ auto: true, on: false });
  const changeLight = useRef<((on: boolean) => Promise<void>) | null>(null);
  const [shot, setShot] = useState<Shot | null>(null),
    [corners, setCorners] = useState<Quad | null>(null),
    [blurry, setBlurry] = useState(false);
  const pdf = useRef<File | null>(null);
  const capture = useRef<(() => void) | null>(null);
  /** Each page's text, by page image, once read; null when it could not be. */
  const [texts, setTexts] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(),
  );
  const requested = useRef(new Set<string>());
  const counting = !!jobId && documentKind === "packing slip";
  // Each new page is read in the background while the next is captured.
  useEffect(() => {
    if (!jobId || documentKind !== "packing slip") return;
    for (const image of pages) {
      if (requested.current.has(image)) continue;
      requested.current.add(image);
      void (async () => {
        let text: string | null = null;
        try {
          const body = await (await fetch(image)).blob();
          const read = () =>
            fetch(
              `/api/job-documents/packing-slips/page-check?jobId=${encodeURIComponent(jobId)}`,
              {
                method: "POST",
                headers: { "content-type": "image/jpeg" },
                body,
              },
            );
          let response = await read();
          // The server reads two pages at a time; one more try when busy.
          if (response.status === 429) {
            await new Promise((done) => setTimeout(done, 1500));
            response = await read();
          }
          if (response.ok)
            text = ((await response.json()) as { text: string | null }).text;
        } catch {
          // Offline or busy: the scan goes on without the count.
        }
        setTexts((old) => new Map(old).set(image, text));
      })();
    }
  }, [pages, jobId, documentKind]);
  const count = counting
    ? scanCount(pages.map((p) => (texts.has(p) ? texts.get(p) : undefined)))
    : null;
  const countMessage = count && scanCountMessage(count);
  /** Numbered pages not captured yet, so Next page leads instead of Done. */
  const pagesToGo = !!count?.missing.length;

  /** Add a straightened page, or replace the last page. */
  const addPage = (page: Pixels, replace: boolean, blur = pageBlur(page)) => {
    const image = toJpeg(page, 0.85);
    setPages((old) => [...(replace ? old.slice(0, -1) : old), image]);
    setBlurry(blur >= BLURRY);
    pdf.current = null;
  };

  useEffect(() => {
    if (mode !== "camera") return;
    let disposed = false,
      stream: MediaStream | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      recent: Quad[] = [],
      steady = 0,
      sharpest = 0,
      capturing = false,
      torchAttempted = false;
    const stop = () => {
      changeLight.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      if (timer) clearTimeout(timer);
    };
    const fail = (e: unknown, fallback: string) => {
      stop();
      if (disposed) return;
      // Camera errors are DOMExceptions, which are not Errors everywhere.
      const name =
        typeof e === "object" && e && "name" in e ? String(e.name) : "";
      setError(
        name === "NotFoundError" || name === "OverconstrainedError"
          ? `No camera found on this device. Upload a photo or PDF of the ${documentKind} instead.`
          : name === "NotAllowedError"
            ? "Camera access is blocked. Allow the camera for this site, or upload a photo or PDF instead."
            : e instanceof Error
              ? e.message
              : fallback,
      );
    };
    const hidden = () => {
      if (document.hidden) {
        stop();
        setError("Camera paused. Tap Restart camera to continue.");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    const take = async (el: HTMLVideoElement) => {
      if (capturing || disposed) return;
      capturing = true;
      setProcessing(true);
      setMessage("Capturing page…");
      try {
        const found = recent.length ? averageQuad(recent.slice(-3)) : null;
        // A shake or focus still settling blurs a frame; another a moment
        // later is often sharp. The sharpest is kept.
        let best: {
          frame: Pixels;
          outline: Quad;
          page: Pixels;
          blur: number;
        } | null = null;
        for (let attempt = 0; attempt <= (found ? RETRIES : 0); attempt++) {
          if (attempt) {
            setMessage("Blurry. Hold still…");
            await new Promise((resolve) => setTimeout(resolve, 250));
            if (disposed) return;
          }
          const frame = grabFrame(el);
          // The preview outline is refined against the full-resolution frame.
          const outline = found ? locatePage(frame, found) : WHOLE_FRAME;
          const page = await rectifyPage(frame, outline);
          const blur = pageBlur(page);
          if (!best || blur < best.blur) best = { frame, outline, page, blur };
          if (blur < BLURRY) break;
        }
        stop();
        if (disposed || !best) return;
        const { frame, outline, page, blur } = best;
        addPage(page, false, blur);
        setShot({ frame, preview: toJpeg(frame, 0.8, 1200), quad: outline });
        if (found) setMode("review");
        else {
          // Nothing was detected, so the corners are placed by hand.
          setCorners(outline);
          setMode("adjust");
        }
      } catch {
        if (!disposed)
          setError(
            "Could not process this page. Restart camera and try again.",
          );
      } finally {
        stop();
        if (!disposed) setProcessing(false);
      }
    };
    const run = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw Error(
            `Live scanning is unavailable in this browser. Upload a photo or PDF of the ${documentKind} instead.`,
          );
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2600 },
            height: { ideal: 3600 },
          },
        });
        if (disposed || document.hidden) {
          stop();
          return;
        }
        const el = video.current!;
        el.srcObject = stream;
        await el.play();
        if (disposed || document.hidden) {
          stop();
          return;
        }
        const track = stream.getVideoTracks()[0]!;
        const capabilities = track.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined;
        setLightSupported(!!capabilities?.torch);
        let changingLight = false;
        const applyLight = async (on: boolean) => {
          if (disposed || changingLight || !capabilities?.torch) return;
          changingLight = true;
          setLightBusy(true);
          try {
            await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
            if (disposed) return;
            setLightOn(on);
            lightPreference.current.on = on;
            setLight(on ? "Camera light on." : "Camera light off.");
            recent = [];
            steady = 0;
          } catch {
            if (!disposed) setLight("Could not change the camera light. Try again or use a well-lit surface.");
          } finally {
            changingLight = false;
            if (!disposed) setLightBusy(false);
          }
        };
        changeLight.current = async (on) => {
          torchAttempted = false;
          await applyLight(on);
        };
        setLight(
          capabilities?.torch
            ? "Light will turn on if needed."
            : "Automatic light unavailable. Use a well-lit surface.",
        );
        if (!lightPreference.current.auto && lightPreference.current.on) await applyLight(true);
        capture.current = () => void take(el);
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const next = (delay: number) => {
          timer = setTimeout(
            () =>
              void tick().catch((e: unknown) =>
                fail(e, "Camera interrupted. Restart camera to continue."),
              ),
            delay,
          );
        };
        const tick = async () => {
          if (disposed || capturing || document.hidden) return;
          if (!el.videoWidth) return next(150);
          setReady(true);
          const scale = PREVIEW / Math.max(el.videoWidth, el.videoHeight);
          canvas.width = Math.round(el.videoWidth * scale);
          canvas.height = Math.round(el.videoHeight * scale);
          ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
          const result = detectPage(
            ctx.getImageData(0, 0, canvas.width, canvas.height).data,
            canvas.width,
            canvas.height,
          );
          if (
            result.brightness < 95 && capabilities?.torch &&
            lightPreference.current.auto && !lightPreference.current.on && !torchAttempted
          ) {
            torchAttempted = true;
            await applyLight(true);
          }
          if (disposed || capturing) return;
          if (!result.quad) {
            recent = [];
            steady = sharpest = 0;
            setQuad(null);
            setLocked(false);
            setMessage(
              result.clipped
                ? "Move back so all four corners of the page are in view."
                : `Point the camera at the ${documentKind}, with all four edges visible.`,
            );
            return next(60);
          }
          if (cornerShift(recent.at(-1) ?? null, result.quad) < SAME_PLACE)
            steady++;
          else {
            recent = [];
            steady = sharpest = 0;
          }
          recent = [...recent.slice(-4), result.quad];
          sharpest = Math.max(sharpest, result.sharpness);
          setQuad(averageQuad(recent.slice(-3)));
          setLocked(steady > 0);
          // Capture the sharpest moment of the hold, once focus has settled.
          const sharp = result.sharpness >= sharpest * 0.8;
          if (steady >= STEADY && sharp) return void (await take(el));
          setMessage(steady && !sharp ? "Focusing…" : "Hold steady…");
          next(60);
        };
        next(0);
      } catch (e) {
        fail(e, "Could not open camera. Check camera permission.");
      }
    };
    setError("");
    setLightSupported(false);
    setLightBusy(false);
    setLightOn(false);
    if (lightPreference.current.auto) lightPreference.current.on = false;
    setQuad(null);
    setLocked(false);
    setReady(false);
    setMessage("Starting camera…");
    void run();
    return () => {
      disposed = true;
      capture.current = null;
      stop();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [mode, restart, documentKind]);

  const [saveStage, setSaveStage] = useState("Preparing PDF…");
  const save = async () => {
    if (
      count?.total &&
      count.missing.length &&
      !window.confirm(
        `The slip is numbered as ${count.total} pages, but ${list(count.missing)} ${count.missing.length === 1 ? "is" : "are"} not captured. Save without ${count.missing.length === 1 ? "it" : "them"}?`,
      )
    )
      return;
    setMode("saving");
    setSaveStage("Preparing PDF…");
    setError("");
    let preparationTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      pdf.current ??= await Promise.race([
        scanPdf(pages, documentKind === "document" ? "Scanned document.pdf" : "Packing slip.pdf"),
        new Promise<never>((_, reject) => {
          preparationTimer = setTimeout(() => reject(new Error("Preparing the PDF took too long. Your captured pages are still here; tap Done to retry.")), 30_000);
        }),
      ]);
      clearTimeout(preparationTimer);
      setSaveStage("Uploading PDF… Keep this window open until the save is confirmed.");
      if (await onSave(pdf.current)) {
        setMode("saved");
        setPages([]);
        setTexts(new Map());
        requested.current.clear();
        setShot(null);
      } else {
        setError(
          "PDF was not saved. Your captured pages are retained; tap Done to retry.",
        );
        setMode("review");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create PDF.");
      setMode("review");
    } finally {
      clearTimeout(preparationTimer);
    }
  };

  const applyCorners = async () => {
    if (!shot || !corners) return;
    setProcessing(true);
    setError("");
    try {
      addPage(await rectifyPage(shot.frame, corners), true);
      setShot({ ...shot, quad: corners });
      setMode("review");
    } catch {
      setError("Could not straighten this page. Try moving the corners.");
    } finally {
      setProcessing(false);
    }
  };

  const drag = (index: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.type === "pointerdown")
      e.currentTarget.setPointerCapture?.(e.pointerId);
    else if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    setCorners(
      (old) => old && (old.map((p, i) => (i === index ? { x, y } : p)) as Quad),
    );
  };

  const leave = () =>
    !pages.length || window.confirm("Discard these unsaved scan pages?");
  const cancelScan = () => {
    if (leave()) onCancel();
  };
  const retakeLast = () => {
    setPages((old) => old.slice(0, -1));
    pdf.current = null;
    setShot(null);
    setBlurry(false);
    setMode("camera");
  };
  const adjustCorners = () => {
    if (!shot) return;
    setCorners(shot.quad);
    setMode("adjust");
  };
  // On a full page the app's back button leaves the scan, so it still asks
  // before unsaved pages are lost.
  useHeaderBackOverride(
    actionBar && mode !== "saving" && mode !== "saved" ? cancelScan : null,
    { priority: 1 },
  );
  // Lowest priority first: the bar puts the last one on the right.
  const barActions =
    mode === "camera" ? (
      <>
        {extraActions}
        {onUpload && !pages.length && (
          <Button key="upload" variant="outline" disabled={processing} onClick={onUpload}>
            <UploadIcon />
            Upload
          </Button>
        )}
        {pages.length > 0 && (
          <Button key="finish" variant="outline" disabled={processing} onClick={() => setMode("review")}>
            <CheckIcon />
            Finish with {pages.length} {pages.length === 1 ? "page" : "pages"}
          </Button>
        )}
        {/* Second only to capturing: the page's way to the waiting slips. */}
        {pageAction?.(leave)}
        {error ? (
          <Button key="restart" onClick={() => setRestart((n) => n + 1)}>
            <RefreshCwIcon />
            Restart camera
          </Button>
        ) : (
          <Button key="capture" disabled={!ready || processing} onClick={() => capture.current?.()}>
            <CameraIcon />
            Capture
          </Button>
        )}
      </>
    ) : mode === "review" || mode === "saving" ? (
      <>
        {mode === "review" && pageAction?.(leave)}
        {shot && (
          <Button key="adjust" variant="outline" disabled={mode === "saving"} onClick={adjustCorners}>
            <CropIcon />
            Adjust corners
          </Button>
        )}
        <Button key="retake" variant="outline" disabled={mode === "saving"} onClick={retakeLast}>
          <RotateCcwIcon />
          Retake last page
        </Button>
        {/* With numbered pages still to capture, Next page takes the lead. */}
        {pagesToGo && (
          <Button key="done" variant="outline" disabled={mode === "saving"} onClick={() => void save()}>
            <CheckIcon />
            Done
          </Button>
        )}
        <Button key="next" variant={pagesToGo ? "default" : "outline"} disabled={mode === "saving" || pages.length >= 20} onClick={() => setMode("camera")}>
          <FilePlus2Icon />
          Next page
        </Button>
        {!pagesToGo && (
          <Button key="done" disabled={mode === "saving"} onClick={() => void save()}>
            <CheckIcon />
            Done
          </Button>
        )}
      </>
    ) : mode === "adjust" ? (
      <>
        {pageAction?.(leave)}
        <Button key="keep" variant="outline" disabled={processing} onClick={() => setMode("review")}>
          <Undo2Icon />
          Keep as is
        </Button>
        <Button key="corners" disabled={processing} onClick={() => void applyCorners()}>
          <CropIcon />
          {processing ? "Straightening…" : "Use these corners"}
        </Button>
      </>
    ) : (
      <Button key="close" onClick={onCancel}>
        <XIcon />
        Close
      </Button>
    );
  const inline = !actionBar;

  return (
    <div className="space-y-3">
      {actionBar &&
        createPortal(<PriorityActionBar>{barActions}</PriorityActionBar>, actionBar)}
      {mode === "camera" && (
        <>
          <div className="relative mx-auto w-fit overflow-hidden rounded-lg bg-black">
            <video
              ref={video}
              playsInline
              muted
              className="max-h-[55dvh] w-auto max-w-full"
            />
            {quad && <Outline quad={quad} locked={locked} />}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              aria-label={lightOn ? "Turn light off" : "Turn light on"}
              aria-pressed={lightOn}
              disabled={!lightSupported || lightBusy || !!error || processing}
              onClick={() => {
                lightPreference.current.auto = false;
                setAutoLight(false);
                void changeLight.current?.(!lightOn);
              }}
            >
              <FlashlightIcon /> Light {lightOn ? "on" : "off"}
            </Button>
            <button
              type="button"
              role="switch"
              aria-checked={autoLight}
              className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm disabled:opacity-50"
              disabled={!lightSupported || lightBusy || !!error || processing}
              onClick={() => {
                const enabled = !autoLight;
                lightPreference.current.auto = enabled;
                setAutoLight(enabled);
                if (enabled) void changeLight.current?.(false);
              }}
            >
              <SwitchTrack checked={autoLight} />
              Auto light
            </button>
          </div>
          <p role="status">{message}</p>
          {pages.length > 0 && countMessage && !countMessage.warn && (
            <p className="text-sm font-medium">{countMessage.text}</p>
          )}
          <p className="text-muted-foreground text-sm">
            {light} Pages capture automatically, or tap {inline ? "Capture now" : "Capture"}.
          </p>
          {inline && (
            <Button
              className="w-full"
              disabled={!ready || processing || !!error}
              onClick={() => capture.current?.()}
            >
              Capture now
            </Button>
          )}
        </>
      )}
      {(mode === "review" || mode === "saving") && (
        <>
          <p role="status">
            ✓ Page {pages.length} captured.{" "}
            {mode === "saving"
              ? saveStage
              : `Check that the whole ${documentKind} is readable.`}
          </p>
          {/* Camera capture stays local until Done saves the PDF. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pages[pages.length - 1]}
            alt={`Captured ${documentKind} page`}
            className="max-h-[45dvh] w-full object-contain"
          />
          {blurry && (
            <p className="text-sm font-medium text-amber-700">
              This page looks blurry, so some numbers may misread. Retake it,
              holding the phone still.
            </p>
          )}
          {countMessage && (
            <p
              className={
                countMessage.warn
                  ? "text-sm font-medium text-amber-700 dark:text-amber-300"
                  : "text-sm font-medium"
              }
            >
              {countMessage.text}
            </p>
          )}
          <p className="text-muted-foreground text-sm">
            {pages.length} page{pages.length === 1 ? "" : "s"} · not saved yet
          </p>
          {inline && <><div className="grid grid-cols-2 gap-2">
            <Button
              variant={pagesToGo ? "default" : "outline"}
              disabled={mode === "saving" || pages.length >= 20}
              onClick={() => setMode("camera")}
            >
              Next page
            </Button>
            <Button variant={pagesToGo ? "outline" : "default"} disabled={mode === "saving"} onClick={() => void save()}>
              Done
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              disabled={mode === "saving"}
              onClick={retakeLast}
            >
              Retake last page
            </Button>
            {shot && (
              <Button
                variant="ghost"
                disabled={mode === "saving"}
                onClick={adjustCorners}
              >
                Adjust corners
              </Button>
            )}
          </div></>}
        </>
      )}
      {mode === "adjust" && shot && corners && (
        <>
          <p role="status">
            Drag the four corners onto the corners of the page.
          </p>
          <div className="relative mx-auto w-fit touch-none select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.preview}
              alt={`Photo of the ${documentKind}`}
              draggable={false}
              className="max-h-[50dvh] w-auto max-w-full rounded-lg"
            />
            <Outline quad={corners} locked />
            {corners.map((p, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Corner ${i + 1}`}
                className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                onPointerDown={drag(i)}
                onPointerMove={drag(i)}
              >
                <span className="size-5 rounded-full border-2 border-white bg-green-500/70 shadow" />
              </button>
            ))}
          </div>
          {inline && <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={processing}
              onClick={() => setMode("review")}
            >
              Keep as is
            </Button>
            <Button disabled={processing} onClick={() => void applyCorners()}>
              {processing ? "Straightening…" : "Use these corners"}
            </Button>
          </div>}
        </>
      )}
      {mode === "saved" && (
        <>
          <p role="status">
            {documentKind === "document"
              ? "✓ PDF saved in Documents."
              : "✓ PDF saved in Documents → Packing Slips and linked to this order and material list."}
          </p>
          {inline && <Button onClick={onCancel}>Close</Button>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {inline && mode === "camera" && (error || onUpload) && (
        <div className="flex flex-wrap gap-2">
          {error && (
            <Button
              variant={onUpload ? "outline" : "default"}
              onClick={() => setRestart((n) => n + 1)}
            >
              Restart camera
            </Button>
          )}
          {onUpload && !pages.length && (
            <Button
              variant={error ? "default" : "outline"}
              disabled={processing}
              onClick={onUpload}
            >
              Upload photo or PDF
            </Button>
          )}
        </div>
      )}
      {inline && mode === "camera" && pages.length > 0 && (
        <Button disabled={processing} onClick={() => setMode("review")}>
          Finish with {pages.length} captured{" "}
          {pages.length === 1 ? "page" : "pages"}
        </Button>
      )}
      {inline && mode !== "saving" && mode !== "saved" && (
        <Button
          variant="ghost"
          disabled={processing}
          onClick={cancelScan}
        >
          Cancel scan
        </Button>
      )}
    </div>
  );
}
