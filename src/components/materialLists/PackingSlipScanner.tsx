"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  detectPage,
  scanPage,
  scanPdf,
  stablePage,
  type Quad,
} from "~/lib/scanning/page";

export default function PackingSlipScanner({
  onSave,
  onCancel,
}: {
  onSave: (file: File) => Promise<boolean>;
  onCancel: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [pages, setPages] = useState<string[]>([]),
    [mode, setMode] = useState<"camera" | "review" | "saving" | "saved">(
      "camera",
    );
  const [message, setMessage] = useState("Starting camera…"),
    [error, setError] = useState(""),
    [quad, setQuad] = useState<Quad | null>(null),
    [restart, setRestart] = useState(0);
  const [light, setLight] = useState(""),
    [processing, setProcessing] = useState(false);
  const pdf = useRef<File | null>(null);
  useEffect(() => {
    if (mode !== "camera") return;
    let disposed = false,
      stream: MediaStream | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      previous: Quad | null = null,
      steady = 0,
      capturing = false,
      torchAttempted = false;
    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      if (timer) clearTimeout(timer);
    };
    const hidden = () => {
      if (document.hidden) {
        stop();
        setError("Camera paused. Tap Restart camera to continue.");
      }
    };
    document.addEventListener("visibilitychange", hidden);
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
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = async () => {
          if (disposed || capturing || document.hidden) return;
          if (!el.videoWidth) {
            timer = setTimeout(
              () =>
                void tick().catch((e: unknown) => {
                  stop();
                  if (!disposed)
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Camera interrupted. Restart camera to continue.",
                    );
                }),
              250,
            );
            return;
          }
          canvas.width = 320;
          canvas.height = Math.round((320 * el.videoHeight) / el.videoWidth);
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
            previous = null;
            steady = 0;
          }
          if (disposed) return;
          setQuad(result.quad);
          if (result.quad && result.sharpness > 70) {
            steady = stablePage(previous, result.quad) ? steady + 1 : 0;
            previous = result.quad;
            setMessage(steady < 4 ? "Hold steady…" : "Capturing page…");
            if (steady >= 4) {
              capturing = true;
              setProcessing(true);
              try {
                const image = await scanPage(el, result.quad);
                if (!disposed) {
                  setPages((old) => [...old, image]);
                  pdf.current = null;
                  setMode("review");
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
              return;
            }
          } else {
            previous = null;
            steady = 0;
            setMessage(
              result.quad
                ? "Hold steady and let the camera focus."
                : "Place the whole page on a darker surface, with all four edges visible.",
            );
          }
          timer = setTimeout(
            () =>
              void tick().catch((e: unknown) => {
                stop();
                if (!disposed)
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Camera interrupted. Restart camera to continue.",
                  );
              }),
            250,
          );
        };
        void tick().catch((e: unknown) => {
          stop();
          if (!disposed)
            setError(
              e instanceof Error
                ? e.message
                : "Camera interrupted. Restart camera to continue.",
            );
        });
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error
              ? e.message
              : "Could not open camera. Check camera permission.",
          );
        stop();
      }
    };
    setError("");
    setQuad(null);
    void run();
    return () => {
      disposed = true;
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
            {quad && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <polygon
                  points={quad
                    .map((p) => `${p.x * 100},${p.y * 100}`)
                    .join(" ")}
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth=".6"
                />
              </svg>
            )}
          </div>
          <p role="status">{message}</p>
          <p className="text-muted-foreground text-sm">{light}</p>
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
          <Button
            variant="ghost"
            disabled={mode === "saving"}
            onClick={() => {
              setPages((old) => old.slice(0, -1));
              pdf.current = null;
              setMode("camera");
            }}
          >
            Retake last page
          </Button>
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
