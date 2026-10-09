"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import {
  SnapshotSourceContext,
  type SnapshotSourceRegistry,
} from "./SnapshotSourceContext";
import {
  currentSnapshotState,
  SNAPSHOT_FREEZE_EVENT,
  makeSnapshotSource,
  snapshotStateSchema,
  type SnapshotSource,
  type SnapshotStateKey,
  type PageViewValue,
} from "~/lib/snapshot-source";
import { capturePageScrolls, restorePageScrolls } from "~/lib/page-view-scroll";
import { SNAPSHOT_EDIT_MESSAGE, SNAPSHOT_EDIT_CHAT } from "~/lib/snapshot-edit";
import { SavedSnapshotPicker } from "./SavedSnapshotPicker";
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
    pathname = usePathname(),
    params = useSearchParams(),
    utils = api.useUtils();
  const editMessageId = params.get(SNAPSHOT_EDIT_MESSAGE);
  const editConversationId = params.get(SNAPSHOT_EDIT_CHAT);
  const editing = Boolean(editMessageId && editConversationId);
  const saved = api.conversations.snapshot.useQuery(
    {
      conversationId: editConversationId ?? "",
      messageId: editMessageId ?? "",
    },
    { enabled: editing, retry: false, refetchOnWindowFocus: false },
  );
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  useEffect(() => {
    const chooseHost = () =>
      setPortalHost(
        document.fullscreenElement ??
          document.querySelector('[data-drawing-fullscreen="true"]') ??
          document.body,
      );
    chooseHost();
    const observer = new MutationObserver(chooseHost);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-drawing-fullscreen"],
    });
    document.addEventListener("fullscreenchange", chooseHost);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", chooseHost);
    };
  }, []);
  const [phase, setPhase] = useState<
    "idle" | "choose" | "capture" | "screen" | "select" | "share" | "error"
  >("idle");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [rect, setRect] = useState<SnapshotRect | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [source, setSource] = useState<SnapshotSource | null>(null);
  const sources = useRef(
    new Map<symbol, { key: SnapshotStateKey; read: () => unknown }>(),
  );
  const register = useCallback<SnapshotSourceRegistry["register"]>(
    (key, read) => {
      const id = Symbol(key);
      sources.current.set(id, { key, read });
      return () => {
        sources.current.delete(id);
      };
    },
    [],
  );
  const pages = useRef(
    new Map<symbol, { key: string; read: () => PageViewValue }>(),
  );
  const registerPage = useCallback<SnapshotSourceRegistry["registerPage"]>(
    (key, read) => {
      const id = Symbol(key);
      pages.current.set(id, { key, read });
      return () => {
        pages.current.delete(id);
      };
    },
    [],
  );
  const captureSource = useCallback(() => {
    window.dispatchEvent(new Event(SNAPSHOT_FREEZE_EVENT));
    const state = snapshotStateSchema.parse({
      version: 1,
      scroll: { x: Math.max(0, scrollX), y: Math.max(0, scrollY) },
      scrolls: capturePageScrolls(),
      pages: Object.fromEntries(
        [...pages.current.values()].map(({ key, read }) => [key, read()]),
      ),
      ...Object.fromEntries(
        [...sources.current.values()]
          .map(({ key, read }) => [key, read()])
          .filter(([, value]) => value !== undefined),
      ),
    });
    const title =
      [...document.querySelectorAll("[data-snapshot-source-title]")]
        .at(-1)
        ?.getAttribute("data-snapshot-source-title") ?? document.title;
    return makeSnapshotSource(window.location.href, state, title);
  }, []);
  const sourceRegistry = useMemo(
    () => ({ register, registerPage, captureSource }),
    [register, registerPage, captureSource],
  );
  useEffect(() => {
    const saved = currentSnapshotState();
    if (!saved?.scroll && !saved?.scrolls?.length) return;
    const pageScroll =
      saved.scroll && !saved.drawing && !saved.document ? saved.scroll : null;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      clearTimeout(timer);
    };
    const restore = () => {
      if (cancelled) return;
      if (pageScroll) window.scrollTo(pageScroll.x, pageScroll.y);
      const complete =
        restorePageScrolls(saved.scrolls ?? []) &&
        (!pageScroll ||
          (Math.abs(window.scrollY - pageScroll.y) <= 1 &&
            Math.abs(window.scrollX - pageScroll.x) <= 1));
      if (!complete && ++attempts < 100) timer = setTimeout(restore, 100);
    };
    window.addEventListener("wheel", cancel, { once: true });
    window.addEventListener("pointerdown", cancel, { once: true });
    restore();
    return () => {
      cancel();
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("pointerdown", cancel);
    };
  }, [pathname]);
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
    source: SnapshotSource | null;
  } | null>(null);
  const create = api.conversations.create.useMutation(),
    send = api.conversations.send.useMutation(),
    replaceSnapshot = api.conversations.replaceSnapshot.useMutation();
  const editAttempt = useRef<{
    conversationId: string;
    targetConversationId: string;
    messageId: string;
    clientId: string;
    expectedRevision: number;
    originalAttachmentId: string;
    attachmentId?: string;
    body: string;
    source: SnapshotSource | null;
    uploaded?: ConversationMessage["attachments"][number];
  } | null>(null);
  const initializedEdit = useRef<string | null>(null);
  const prepareEdit = () => {
    if (saved.data && initializedEdit.current !== saved.data.id) {
      setMessage("");
      setTarget({ mode: "direct", recipientIds: [], name: "" });
      initializedEdit.current = saved.data.id;
    }
  };
  const release = useCallback(() => {
    generation.current++;
    drag.current = null;
    setPhase("idle");
    setCapture(null);
    setRect(null);
    setBlob(null);
    setPreview("");
    setSource(null);
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
    if (editAttempt.current?.uploaded)
      void removePendingConversationFile(editAttempt.current.uploaded.id).catch(
        () => undefined,
      );
    editAttempt.current = null;
    initializedEdit.current = null;
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
  const finishCapture = async (
    makeCanvas: (cancelled: () => boolean) => Promise<HTMLCanvasElement | null>,
  ) => {
    const current = ++generation.current;
    setPhase("capture");
    setError("");
    try {
      const canvas = await makeCanvas(() => current !== generation.current);
      if (current !== generation.current) return;
      if (!canvas) {
        setPhase("screen");
        return;
      }
      setSource(captureSource());
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
  const beginCapture = () => {
    if (phase !== "idle" && phase !== "choose") return;
    if (editing && !saved.data) return;
    if (editing) prepareEdit();
    window.dispatchEvent(new Event(SNAPSHOT_FREEZE_EVENT));
    if (needsScreenCapture()) {
      setPhase("screen");
      return;
    }
    void finishCapture(async (cancelled) => {
      const state = editing ? currentSnapshotState() : null;
      const needed = (["drawing", "document", "pdf"] as const).filter(
        (key) => state?.[key],
      );
      const deadline = Date.now() + 15_000;
      while (
        (needed.includes("drawing") &&
          !document.querySelector("[data-snapshot-source-title]")) ||
        needed.some(
          (key) =>
            ![...sources.current.values()].some(
              (entry) => entry.key === key && entry.read() !== undefined,
            ),
        )
      ) {
        if (cancelled()) throw new Error("Snapshot cancelled.");
        if (Date.now() > deadline)
          throw new Error(
            "The saved view is still loading. Try Snapshot again when it is ready.",
          );
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (cancelled()) throw new Error("Snapshot cancelled.");
      return needsScreenCapture() ? null : captureVisiblePage();
    });
  };
  const start = () => {
    if (phase !== "idle") return;
    if (editing) beginCapture();
    else setPhase("choose");
  };
  const captureOnOpen = useEffectEvent(() => beginCapture());
  const autoStarted = useRef<string | null>(null);
  useEffect(() => {
    if (
      !editing ||
      !saved.data ||
      phase !== "idle" ||
      autoStarted.current === saved.data.id
    )
      return;
    const id = saved.data.id;
    const timer = setTimeout(() => {
      autoStarted.current = id;
      captureOnOpen();
    }, 0);
    return () => clearTimeout(timer);
  }, [editing, saved.data, phase]);
  const screenCapture = () => {
    setUsingScreen(true);
    void finishCapture(() => captureSharedScreen());
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
      await finishCapture(() => Promise.resolve(canvas));
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
    if (busy || !blob || !validChatTarget(target) || (editing && !saved.data))
      return;
    setBusy(true);
    setError("");
    setLocked(true);
    try {
      if (editing && saved.data) {
        if (!editAttempt.current) {
          const destination =
            target.mode === "existing"
              ? target.conversationId
              : (
                  await create.mutateAsync({
                    kind: target.mode,
                    name: target.name,
                    recipientIds: target.recipientIds,
                  })
                ).id;
          editAttempt.current = {
            conversationId: saved.data.conversationId,
            targetConversationId: destination,
            messageId: saved.data.id,
            clientId: crypto.randomUUID(),
            expectedRevision: saved.data.revision,
            originalAttachmentId: saved.data.image.id,
            body: message.trim() || "Snapshot",
            source,
          };
        }
        const current = editAttempt.current;
        if (!current.attachmentId) {
          current.uploaded ??= await uploadConversationFile(
            current.targetConversationId,
            new File([blob], `snapshot-${Date.now()}.png`, {
              type: "image/png",
            }),
          );
          current.attachmentId = current.uploaded.id;
        }
        await replaceSnapshot.mutateAsync({
          targetConversationId: current.targetConversationId,
          conversationId: current.conversationId,
          messageId: current.messageId,
          clientId: current.clientId,
          expectedRevision: current.expectedRevision,
          originalAttachmentId: current.originalAttachmentId,
          attachmentId: current.attachmentId,
          body: current.body,
          source: current.source,
        });
        const id = current.targetConversationId;
        const oldConversationId = current.conversationId;
        editAttempt.current = null;
        release();
        await Promise.all([
          utils.conversations.list.invalidate(),
          utils.conversations.history.invalidate({ conversationId: id }),
          utils.conversations.history.invalidate({
            conversationId: oldConversationId,
          }),
          utils.conversations.savedSnapshots.invalidate(),
        ]);
        router.push(`/dashboard/chat?conversation=${encodeURIComponent(id)}`);
        return;
      }
      if (!blob) return;
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
          source,
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
        source: current.source,
      });
      const id = current.conversationId;
      attempt.current = null;
      release();
      await Promise.all([
        utils.conversations.list.invalidate(),
        utils.conversations.savedSnapshots.invalidate(),
      ]);
      router.push(`/dashboard/chat?conversation=${encodeURIComponent(id)}`);
    } catch (reason) {
      if (!attempt.current && !editAttempt.current) setLocked(false);
      setError(
        reason instanceof Error
          ? reason.message
          : editing
            ? "Could not confirm the new snapshot was sent. Try again."
            : "Could not confirm the snapshot was sent. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const cancelEdit = () => {
    release();
    router.push(
      `/dashboard/chat?conversation=${encodeURIComponent(editConversationId ?? "")}`,
    );
  };
  const retake = () => {
    if (attempt.current?.file)
      void removePendingConversationFile(attempt.current.file.id).catch(
        () => undefined,
      );
    if (editAttempt.current?.uploaded)
      void removePendingConversationFile(editAttempt.current.uploaded.id).catch(
        () => undefined,
      );
    attempt.current = null;
    editAttempt.current = null;
    setLocked(false);
    setBlob(null);
    setPreview("");
    setRect(null);
    setError("");
    if (capture) setPhase("select");
    else setPhase("idle");
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
          portalHost ?? document.body,
        )
      : null;
  return (
    <SnapshotContext.Provider value={{ start }}>
      <SnapshotSourceContext.Provider value={sourceRegistry}>
        {children}
        {editing &&
          phase === "idle" &&
          portalHost &&
          createPortal(
            <aside
              data-snapshot-ui
              aria-label="Edit saved snapshot"
              className="bg-background fixed inset-x-3 top-16 z-[90] mx-auto max-w-xl space-y-2 rounded-lg border p-3 shadow-lg"
            >
              <p className="text-sm font-semibold">Remake snapshot</p>
              <p
                className="text-muted-foreground text-xs"
                role={saved.error ? "alert" : "status"}
              >
                {saved.error
                  ? saved.error.message
                  : saved.data
                    ? saved.data.source
                      ? "Capture and send a new snapshot to replace the old one."
                      : "This older snapshot has no saved source. Capture a new view to replace it."
                    : "Opening the saved snapshot…"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={beginCapture}
                  disabled={!saved.data || Boolean(saved.error)}
                >
                  Capture snapshot
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEdit}>
                  Cancel edit
                </Button>
              </div>
            </aside>,
            portalHost,
          )}
        {overlay}
        <Dialog
          open={
            phase === "choose" ||
            phase === "share" ||
            phase === "screen" ||
            phase === "error"
          }
          onOpenChange={(open) => {
            if (!open && !busy) release();
          }}
        >
          <DialogContent
            excludeFromSnapshot
            portalContainer={portalHost}
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
              {phase === "choose"
                ? "Capture a new view or reopen one of your saved snapshots to make changes."
                : phase === "share"
                  ? editing
                    ? "Choose who should receive this new snapshot. Sending replaces the old snapshot."
                    : "Review the image and choose who should receive it."
                  : "Capture a selected area and share it in chat."}
            </DialogDescription>
            {phase === "choose" ? (
              <SavedSnapshotPicker
                onCapture={beginCapture}
                onEdit={(href) => {
                  release();
                  // Saved view state is restored when its page mounts. A full
                  // navigation also restores it when editing the same drawing.
                  window.location.assign(href);
                }}
              />
            ) : phase === "share" ? (
              <>
                <img
                  alt="Snapshot preview"
                  src={preview}
                  className="bg-muted max-h-48 w-full rounded-md border object-contain"
                />
                {source && (
                  <p className="text-muted-foreground text-xs">
                    Includes a link back to{" "}
                    <span className="font-medium">{source.title}</span> in this
                    view.
                  </p>
                )}
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
                {editing && error && locked && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => window.location.reload()}
                  >
                    Reopen saved snapshot
                  </Button>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" disabled={busy} onClick={retake}>
                    Retake
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      !validChatTarget(target) ||
                      (editing && !saved.data)
                    }
                    onClick={() => void share()}
                  >
                    {busy
                      ? "Sending…"
                      : locked
                        ? "Retry send"
                        : "Send snapshot"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {phase === "screen" ? (
                  <p className="text-sm">
                    For the live document editor, choose this browser tab in the
                    screen picker. Sharing stops as soon as the image is
                    captured.
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
      </SnapshotSourceContext.Provider>
    </SnapshotContext.Provider>
  );
}
