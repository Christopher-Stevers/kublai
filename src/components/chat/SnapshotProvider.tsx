"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CameraIcon, Loader2Icon, XIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  RecipientChooser,
  validChatTarget,
  type ChatTarget,
} from "./RecipientChooser";
import {
  captureVisiblePage,
  captureSharedScreen,
  needsScreenCapture,
  cropSnapshot,
  snapshotRect,
  type SnapshotRect,
} from "~/lib/snapshot-capture";
import {
  uploadConversationFile,
  removePendingConversationFile,
} from "~/lib/conversation-upload";
import type { ConversationMessage } from "~/server/conversations/contracts";
const SnapshotContext = createContext<{ start: () => void } | null>(null);
export const useSnapshot = () => useContext(SnapshotContext);
type Capture = {
  canvas: HTMLCanvasElement;
  url: string;
  width: number;
  height: number;
};
export function SnapshotProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter(),
    utils = api.useUtils();
  const [phase, setPhase] = useState<
    "idle" | "capture" | "screen" | "select" | "share" | "error"
  >("idle");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [rect, setRect] = useState<SnapshotRect | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [target, setTarget] = useState<ChatTarget>({
    mode: "direct",
    recipientIds: [],
    name: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [usingScreen, setUsingScreen] = useState(false);
  const screenshotInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null),
    generation = useRef(0);
  const attempt = useRef<{
    conversationId: string;
    file?: ConversationMessage["attachments"][number];
    clientId: string;
    body: string;
  } | null>(null);
  const create = api.conversations.create.useMutation(),
    send = api.conversations.send.useMutation();
  const release = useCallback(() => {
    generation.current++;
    drag.current = null;
    setPhase("idle");
    setCapture(null);
    setRect(null);
    setBlob(null);
    setPreview("");
    setUsingScreen(false);
    setError("");
    setLocked(false);
    setMessage("");
    setTarget({ mode: "direct", recipientIds: [], name: "" });
    if (attempt.current?.file)
      void removePendingConversationFile(attempt.current.file.id).catch(
        () => undefined,
      );
    attempt.current = null;
  }, []);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);
  useEffect(() => {
    if (phase !== "select" || !capture) return;
    const resized = () => {
      if (innerWidth === capture.width && innerHeight === capture.height)
        return;
      drag.current = null;
      setCapture(null);
      setError(
        "The view size changed. Start Snapshot again to capture the current view.",
      );
      setPhase("error");
    };
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, [phase, capture]);
  useEffect(() => {
    if (phase === "idle") return;
    const overlay = document.querySelector<HTMLElement>(
      "[data-snapshot-selection]",
    );
    overlay
      ?.querySelector<HTMLButtonElement>('button[aria-label="Cancel snapshot"]')
      ?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Tab" && overlay) {
        const buttons = [
          ...overlay.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        ];
        if (buttons.length) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (index + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length
          ]?.focus();
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!busy) release();
      }
    };
    window.addEventListener("keydown", handle, true);
    return () => window.removeEventListener("keydown", handle, true);
  }, [phase, busy, release]);
  const finishCapture = async (promise: Promise<HTMLCanvasElement>) => {
    const current = ++generation.current;
    setPhase("capture");
    setError("");
    try {
      const canvas = await promise;
      if (current !== generation.current) return;
      setCapture({
        canvas,
        url: canvas.toDataURL("image/png"),
        width: innerWidth,
        height: innerHeight,
      });
      setPhase("select");
    } catch (reason) {
      if (current !== generation.current) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not capture the page.",
      );
      setPhase("error");
    }
  };
  const start = () => {
    if (phase !== "idle") return;
    if (needsScreenCapture()) {
      setPhase("screen");
      return;
    }
    void finishCapture(captureVisiblePage());
  };
  const screenCapture = () => {
    setUsingScreen(true);
    void finishCapture(captureSharedScreen());
  };
  const chooseScreenshot = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setError("Choose an image smaller than 10 MB.");
      setPhase("error");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(innerWidth * ratio);
      canvas.height = Math.round(innerHeight * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Image capture is unavailable.");
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(
        canvas.width / image.naturalWidth,
        canvas.height / image.naturalHeight,
      );
      ctx.drawImage(
        image,
        (canvas.width - image.naturalWidth * scale) / 2,
        (canvas.height - image.naturalHeight * scale) / 2,
        image.naturalWidth * scale,
        image.naturalHeight * scale,
      );
      setUsingScreen(false);
      await finishCapture(Promise.resolve(canvas));
    } catch {
      setError("Could not open this screenshot. Choose a PNG or JPEG image.");
      setPhase("error");
    } finally {
      URL.revokeObjectURL(url);
      if (screenshotInput.current) screenshotInput.current.value = "";
    }
  };
  const crop = async (selected: SnapshotRect) => {
    if (!capture || selected.width < 12 || selected.height < 12) {
      setError("Drag a window at least 12 pixels wide and high.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const image = await cropSnapshot(capture.canvas, selected, capture);
      setBlob(image);
      setPreview(URL.createObjectURL(image));
      setPhase("share");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not crop the image.",
      );
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    if (!blob || busy || !validChatTarget(target)) return;
    setBusy(true);
    setError("");
    setLocked(true);
    try {
      if (!attempt.current) {
        const id =
          target.mode === "existing"
            ? target.conversationId
            : (
                await create.mutateAsync({
                  kind: target.mode,
                  name: target.name,
                  recipientIds: target.recipientIds,
                })
              ).id;
        attempt.current = {
          conversationId: id,
          clientId: crypto.randomUUID(),
          body: message.trim() || "Snapshot",
        };
      }
      const current = attempt.current;
      current.file ??= await uploadConversationFile(
        current.conversationId,
        new File(
          [blob],
          `snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
          { type: "image/png" },
        ),
      );
      await send.mutateAsync({
        conversationId: current.conversationId,
        clientId: current.clientId,
        body: current.body,
        attachmentIds: [current.file.id],
      });
      const id = current.conversationId;
      attempt.current = null;
      release();
      await utils.conversations.list.invalidate();
      router.push(`/dashboard/chat?conversation=${encodeURIComponent(id)}`);
    } catch (reason) {
      if (!attempt.current) setLocked(false);
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not confirm the snapshot was sent. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const overlay =
    ((phase === "capture" && !usingScreen) || phase === "select") &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            data-snapshot-ui
            data-snapshot-selection
            role="dialog"
            aria-modal="true"
            aria-label="Select snapshot area"
            className="fixed inset-0 z-[200] touch-none overflow-hidden bg-black/20"
            style={{
              cursor: phase === "select" ? "crosshair" : "wait",
              pointerEvents: "auto",
            }}
            onPointerDown={(e) => {
              if (
                phase !== "select" ||
                busy ||
                e.button !== 0 ||
                (e.target as Element).closest("button")
              )
                return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY };
              setRect(null);
              setError("");
            }}
            onPointerMove={(e) => {
              if (!drag.current || !capture) return;
              setRect(
                snapshotRect(
                  drag.current,
                  { x: e.clientX, y: e.clientY },
                  capture.width,
                  capture.height,
                ),
              );
            }}
            onPointerUp={(e) => {
              if (!drag.current || !capture) return;
              const selected = snapshotRect(
                drag.current,
                { x: e.clientX, y: e.clientY },
                capture.width,
                capture.height,
              );
              drag.current = null;
              setRect(selected);
              void crop(selected);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setRect(null);
            }}
          >
            {capture && phase === "select" && (
              <img
                alt="Page ready for snapshot selection"
                src={capture.url}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            )}
            {rect && (
              <div
                className="pointer-events-none absolute border-2 border-sky-400 bg-sky-300/10"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
                }}
              />
            )}
            <div className="bg-background absolute top-3 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-3 rounded-lg border px-3 py-2 shadow-lg">
              <span className="text-sm">
                {phase === "capture"
                  ? "Preparing snapshot…"
                  : busy
                    ? "Creating image…"
                    : "Drag a window around the area to share."}
              </span>
              {phase === "capture" || busy ? (
                <Loader2Icon className="size-4 shrink-0 animate-spin" />
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    capture &&
                    void crop({
                      x: 0,
                      y: 0,
                      width: capture.width,
                      height: capture.height,
                    })
                  }
                >
                  Whole view
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                aria-label="Cancel snapshot"
                onClick={release}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
            {error && (
              <p
                role="alert"
                className="bg-background text-destructive absolute bottom-4 left-1/2 max-w-[95%] -translate-x-1/2 rounded-md p-3 text-sm"
              >
                {error}
              </p>
            )}
          </div>,
          document.body,
        )
      : null;
  return (
    <SnapshotContext.Provider value={{ start }}>
      {children}
      {overlay}
      <Dialog
        open={phase === "share" || phase === "screen" || phase === "error"}
        onOpenChange={(open) => {
          if (!open && !busy) release();
        }}
      >
        <DialogContent
          data-snapshot-ui
          className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
          showCloseButton={!busy}
        >
          <input
            ref={screenshotInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            aria-label="Choose screenshot image"
            onChange={(e) => void chooseScreenshot(e.target.files?.[0])}
          />
          <DialogTitle>
            <span className="flex items-center gap-2">
              <CameraIcon className="size-5" />
              Snapshot
            </span>
          </DialogTitle>
          <DialogDescription>
            {phase === "share"
              ? "Review the image and choose who should receive it."
              : "Capture a selected area and share it in chat."}
          </DialogDescription>
          {phase === "share" ? (
            <>
              <img
                alt="Snapshot preview"
                src={preview}
                className="bg-muted max-h-48 w-full rounded-md border object-contain"
              />
              <RecipientChooser
                value={target}
                onChange={setTarget}
                disabled={busy || locked}
              />
              <label className="space-y-1 text-sm">
                Message (optional)
                <textarea
                  aria-label="Snapshot message"
                  disabled={busy || locked}
                  value={message}
                  maxLength={8000}
                  onChange={(e) => setMessage(e.target.value)}
                  className="bg-background block min-h-20 w-full rounded-md border p-2"
                />
              </label>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (attempt.current?.file)
                      void removePendingConversationFile(
                        attempt.current.file.id,
                      ).catch(() => undefined);
                    attempt.current = null;
                    setLocked(false);
                    setPhase("select");
                    setRect(null);
                  }}
                >
                  Retake
                </Button>
                <Button
                  disabled={busy || !validChatTarget(target)}
                  onClick={() => void share()}
                >
                  {busy ? "Sending…" : locked ? "Retry send" : "Send snapshot"}
                </Button>
              </div>
            </>
          ) : (
            <>
              {phase === "screen" ? (
                <p className="text-sm">
                  For the live document editor, choose this browser tab in the
                  screen picker. Sharing stops as soon as the image is captured.
                </p>
              ) : (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={release}>
                  Cancel
                </Button>
                <Button onClick={screenCapture}>Capture screen</Button>
                <Button
                  variant="outline"
                  onClick={() => screenshotInput.current?.click()}
                >
                  Choose screenshot
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SnapshotContext.Provider>
  );
}
