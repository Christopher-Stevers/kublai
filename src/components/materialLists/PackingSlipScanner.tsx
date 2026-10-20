"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "~/components/ui/button";
import {
  averageQuad,
  cornerShift,
  detectPage,
  grabFrame,
  locatePage,
  rectifyPage,
  scanPdf,
  toJpeg,
  type Pixels,
  type Quad,
} from "~/lib/scanning/page";

/** Long side of the preview frames searched for the page. */
const PREVIEW = 480;
/** Matching outlines in a row before an automatic capture (about half a second). */
const STEADY = 4;
/** Outlines closer than this, in frame fractions, count as the same position. */
const SAME_PLACE = 0.02;
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
}: {
  onSave: (file: File) => Promise<boolean>;
  onCancel: () => void;
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
  const [shot, setShot] = useState<Shot | null>(null),
    [corners, setCorners] = useState<Quad | null>(null);
  const pdf = useRef<File | null>(null);
  const capture = useRef<(() => void) | null>(null);

  /** Straighten the page in a frame and add it, or replace the last page. */
  const addPage = async (frame: Pixels, outline: Quad, replace: boolean) => {
    const image = toJpeg(await rectifyPage(frame, outline), 0.85);
    setPages((old) => [...(replace ? old.slice(0, -1) : old), image]);
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
      stream?.getTracks().forEach((t) => t.stop());
      if (timer) clearTimeout(timer);
    };
    const fail = (e: unknown, fallback: string) => {
      stop();
      if (!disposed) setError(e instanceof Error ? e.message : fallback);
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
        const frame = grabFrame(el);
        stop();
        const found = recent.length ? averageQuad(recent.slice(-3)) : null;
        // The preview outline is refined against the full-resolution frame.
        const outline = found ? locatePage(frame, found) : WHOLE_FRAME;
        await addPage(frame, outline, false);
        if (disposed) return;
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
            "Live scanning is unavailable in this browser. Close the scanner and use Upload photo or PDF.",
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
        setLight(
          capabilities?.torch
            ? "Light will turn on if needed."
            : "Automatic light unavailable. Use a well-lit surface.",
        );
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
            result.brightness < 95 &&
            capabilities?.torch &&
            !torchAttempted
          ) {
            torchAttempted = true;
            try {
              await track.applyConstraints({
                advanced: [{ torch: true } as MediaTrackConstraintSet],
              });
              setLight("Camera light on.");
            } catch {
              setLight("Could not turn on light. Move to a brighter area.");
            }
            recent = [];
            steady = 0;
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
                : "Point the camera at the packing slip, with all four edges visible.",
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
  }, [mode, restart]);

  const save = async () => {
    setMode("saving");
    setError("");
    try {
      pdf.current ??= await scanPdf(pages);
      if (await onSave(pdf.current)) {
        setMode("saved");
        setPages([]);
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
    }
  };

  const applyCorners = async () => {
    if (!shot || !corners) return;
    setProcessing(true);
    setError("");
    try {
      await addPage(shot.frame, corners, true);
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

  return (
    <div className="space-y-3">
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
          <p role="status">{message}</p>
          <p className="text-muted-foreground text-sm">
            {light} Pages capture automatically, or tap Capture now.
          </p>
          <Button
            className="w-full"
            disabled={!ready || processing || !!error}
            onClick={() => capture.current?.()}
          >
            Capture now
          </Button>
        </>
      )}
      {(mode === "review" || mode === "saving") && (
        <>
          <p role="status">
            ✓ Page {pages.length} captured.{" "}
            {mode === "saving"
              ? "Saving PDF…"
              : "Check that the whole slip is readable."}
          </p>
          {/* Camera capture stays local until Done saves the PDF. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pages[pages.length - 1]}
            alt="Captured packing slip page"
            className="max-h-[45dvh] w-full object-contain"
          />
          <p className="text-muted-foreground text-sm">
            {pages.length} page{pages.length === 1 ? "" : "s"} · not saved yet
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={mode === "saving" || pages.length >= 20}
              onClick={() => setMode("camera")}
            >
              Next page
            </Button>
            <Button disabled={mode === "saving"} onClick={() => void save()}>
              Done
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="ghost"
              disabled={mode === "saving"}
              onClick={() => {
                setPages((old) => old.slice(0, -1));
                pdf.current = null;
                setShot(null);
                setMode("camera");
              }}
            >
              Retake last page
            </Button>
            {shot && (
              <Button
                variant="ghost"
                disabled={mode === "saving"}
                onClick={() => {
                  setCorners(shot.quad);
                  setMode("adjust");
                }}
              >
                Adjust corners
              </Button>
            )}
          </div>
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
              alt="Photo of the packing slip"
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
          <div className="grid grid-cols-2 gap-2">
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
          </div>
        </>
      )}
      {mode === "saved" && (
        <>
          <p role="status">
            ✓ PDF saved in Documents → Packing Slips and linked to this order
            and material list.
          </p>
          <Button onClick={onCancel}>Close</Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {mode === "camera" && error && (
        <Button onClick={() => setRestart((n) => n + 1)}>Restart camera</Button>
      )}
      {mode === "camera" && pages.length > 0 && (
        <Button disabled={processing} onClick={() => setMode("review")}>
          Finish with {pages.length} captured pages
        </Button>
      )}
      {mode !== "saving" && mode !== "saved" && (
        <Button
          variant="ghost"
          disabled={processing}
          onClick={() => {
            if (
              !pages.length ||
              window.confirm("Discard these unsaved scan pages?")
            )
              onCancel();
          }}
        >
          Cancel scan
        </Button>
      )}
    </div>
  );
}
