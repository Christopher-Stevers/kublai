"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon, CameraOffIcon, ScanLineIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { tagFromScan } from "~/lib/asset-tags";

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };

function createDetector(): Detector | null {
  const Ctor = (globalThis as { BarcodeDetector?: new (options: { formats: string[] }) => Detector })
    .BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: ["qr_code", "code_128", "code_39"] });
  } catch {
    return null;
  }
}

/**
 * Reads tool tags three ways: the phone camera (where the browser can decode
 * QR codes), a USB/Bluetooth scanner that types the tag and presses Enter,
 * or typing the tag by hand.
 */
export function TagScanner({
  onTag,
  busy,
  autoFocus,
  label = "Scan or type a tool tag",
}: {
  onTag: (tag: string) => void | Promise<void>;
  busy?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const [value, setValue] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraSupported, setCameraSupported] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onTagRef = useRef(onTag);
  onTagRef.current = onTag;

  useEffect(() => {
    setCameraSupported(createDetector() !== null && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    if (!cameraOn) return;
    const detector = createDetector();
    if (!detector) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = { tag: "", at: 0 };

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          const raw = codes[0]?.rawValue;
          if (raw) {
            const tag = tagFromScan(raw);
            const now = Date.now();
            // The same label stays in view for a while; only report it once.
            if (tag !== last.tag || now - last.at > 2500) {
              last = { tag, at: now };
              navigator.vibrate?.(60);
              void onTagRef.current(tag);
            }
          }
        } catch {
          // A frame that can't be read is normal; keep going.
        }
      }
      timer = setTimeout(() => void tick(), 250);
    };

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (videoRef.current) {
          videoRef.current.srcObject = media;
          await videoRef.current.play().catch(() => undefined);
        }
        void tick();
      })
      .catch(() => {
        setCameraError("Camera unavailable. Check the browser's camera permission.");
        setCameraOn(false);
      });

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraOn]);

  const submit = () => {
    const tag = tagFromScan(value);
    if (!tag) return;
    setValue("");
    void onTag(tag);
  };

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <ScanLineIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={label}
            aria-label={label}
            autoFocus={autoFocus}
            autoCapitalize="characters"
            autoComplete="off"
            className="pl-8"
          />
        </div>
        <Button type="submit" disabled={busy || !value.trim()}>
          Go
        </Button>
        {cameraSupported && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCameraError(null);
              setCameraOn((on) => !on);
            }}
            aria-label={cameraOn ? "Stop camera" : "Scan with camera"}
          >
            {cameraOn ? <CameraOffIcon className="h-4 w-4" /> : <CameraIcon className="h-4 w-4" />}
          </Button>
        )}
      </form>
      {cameraOn && (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
        </div>
      )}
      {cameraError && <p className="text-destructive text-xs">{cameraError}</p>}
      {!cameraSupported && (
        <p className="text-muted-foreground text-xs">
          Tip: point your phone&apos;s camera app at a tool&apos;s QR label to open it here.
        </p>
      )}
    </div>
  );
}
