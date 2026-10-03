"use client";

import { useAuth } from "@clerk/nextjs";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  BellOffIcon,
  BellRingIcon,
  CopyIcon,
  FileIcon,
  Loader2Icon,
  PaperclipIcon,
  ReplyIcon,
  SendIcon,
  Trash2Icon,
  UsersIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import type { ChatAttachment, ChatMessage } from "~/server/chat/contracts";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { Button } from "~/components/ui/button";
import { confirmAction } from "~/components/ui/app-dialogs";
import { ChatNotifications } from "./ChatNotifications";
import {
  loadChatDraft,
  mergeChatMessages,
  newChatDraft,
  saveChatDraft,
  type ChatDraft,
} from "~/lib/job-chat-drafts";

const ALLOWED_FILES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
function nearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 90;
}
const LONG_PRESS_MS = 450;
// Expanded steel laid over the (shaded) checker plate, which shows through the holes.
const EXPANDED_METAL = {
  backgroundImage:
    "url(/images/chat-expanded-metal.webp?v=2), linear-gradient(rgba(12,20,32,0.42), rgba(12,20,32,0.42)), url(/images/chat-checker-plate.webp?v=2)",
  backgroundSize: "56px 28px, auto, 96px 96px",
  backgroundColor: "#5d6f86",
};
/** Riveted steel angle along the join between expanded steel and checker plate. */
function AngleTrim({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden="true"
      className="relative z-10 h-4 shrink-0"
      style={{
        backgroundImage: "url(/images/chat-angle-trim.webp?v=1)",
        backgroundSize: "96px 16px",
        backgroundRepeat: "repeat-x",
        boxShadow:
          edge === "top"
            ? "0 3px 5px rgba(0,0,0,0.45)"
            : "0 -3px 5px rgba(0,0,0,0.35)",
      }}
    />
  );
}
const ON_METAL = "text-white hover:bg-white/15 hover:text-white";
const CHECKER_PLATE = {
  backgroundImage: "url(/images/chat-checker-plate.webp?v=2)",
  backgroundSize: "96px 96px",
  backgroundColor: "#879cb9",
};

/** Opens a message's actions on a long press (touch or mouse) or right-click. */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (
        start.current &&
        Math.hypot(
          event.clientX - start.current.x,
          event.clientY - start.current.y,
        ) > 10
      )
        cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      cancel();
      if (!fired.current) onLongPress();
      fired.current = true;
    },
    // The press that opened the menu must not also open an attachment.
    onClickCapture: (event: React.MouseEvent) => {
      if (!fired.current) return;
      event.preventDefault();
      event.stopPropagation();
      fired.current = false;
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (
        event.target === event.currentTarget &&
        (event.key === "Enter" || event.key === "ContextMenu")
      ) {
        event.preventDefault();
        onLongPress();
      }
    },
  };
}

export function JobChatView({ jobId }: { jobId: string }) {
  const { userId, isLoaded } = useAuth();
  return (
    <div className="bg-card fixed inset-x-0 top-14 bottom-0 z-30 overflow-hidden sm:top-16">
      {!isLoaded ? (
        <p role="status" className="p-4">
          Loading chat…
        </p>
      ) : userId ? (
        <ChatLobby key={`${userId}:${jobId}`} jobId={jobId} userId={userId} />
      ) : (
        <p className="p-4">Sign in to open job chat.</p>
      )}
    </div>
  );
}

function ChatLobby({ jobId, userId }: { jobId: string; userId: string }) {
  const online = useOnlineStatus();
  const utils = api.useUtils();
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  const [connected, setConnected] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [older, setOlder] = useState<Record<string, ChatMessage[]>>({});
  const [olderCursor, setOlderCursor] = useState<number | null | undefined>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState<ChatDraft>(newChatDraft);
  const draftRef = useRef(draft);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [showBell, setShowBell] = useState(false);
  const [actionsFor, setActionsFor] = useState<ChatMessage | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const panel = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState<number>();
  const timeline = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastRead = useRef(0);
  const readRetryAfter = useRef(0);
  const joinAttempted = useRef(false);
  const eventCursor = useRef(0);
  const previousLatest = useRef<{
    messages: ChatMessage[];
    nextBeforeSequence: number | null;
  } | null>(null);
  const draftKey = `${userId}:${jobId}`;
  const overview = api.chat.getOverview.useQuery(
    { jobId },
    {
      enabled: online,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchInterval: visible && online ? 30_000 : false,
    },
  );
  const accessRevoked = ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(
    overview.error?.data?.code ?? "",
  );
  const history = api.chat.history.useQuery(
    { jobId, limit: 50 },
    {
      enabled: online && !accessRevoked && overview.data?.joined === true,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchInterval: online && visible && !connected ? 20_000 : false,
    },
  );
  const members = api.chat.members.useQuery(
    { jobId },
    { enabled: online && showMembers && overview.data?.joined === true },
  );
  const join = api.chat.join.useMutation();
  const send = api.chat.send.useMutation();
  const remove = api.chat.delete.useMutation();
  const markRead = api.chat.markRead.useMutation();
  const mute = api.chat.setNotifications.useMutation();
  const messages = useMemo(
    () =>
      mergeChatMessages(...Object.values(older), history.data?.messages ?? []),
    [older, history.data?.messages],
  );
  // The server can observe a newer row after taking the history snapshot.
  // Only acknowledge a sequence that is actually displayed in this timeline.
  const displayedSequence = messages.at(-1)?.sequence ?? 0;
  const nextBefore =
    olderCursor === undefined ? history.data?.nextBeforeSequence : olderCursor;

  useEffect(() => {
    const resize = () => {
      if (!panel.current) return;
      const viewport = window.visualViewport;
      const bottom =
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      setPanelHeight(
        Math.max(0, bottom - panel.current.getBoundingClientRect().top),
      );
    };
    const frame = requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, []);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    let mounted = true;
    void loadChatDraft(draftKey)
      .then((saved) => {
        if (!mounted) return;
        if (saved) {
          draftRef.current = saved;
          setDraft(saved);
        }
      })
      .catch(() => {
        if (mounted) setStorageError(true);
      })
      .finally(() => {
        if (mounted) setDraftLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [draftKey]);
  const changeDraft = useCallback(
    (next: ChatDraft) => {
      draftRef.current = next;
      setDraft(next);
      void saveChatDraft(draftKey, next).catch(() => setStorageError(true));
    },
    [draftKey],
  );
  const clearDeliveredDraft = useCallback(async () => {
    const next = newChatDraft();
    draftRef.current = next;
    setDraft(next);
    await saveChatDraft(draftKey, null).catch(() => setStorageError(true));
  }, [draftKey]);
  const joinLobby = useCallback(async () => {
    joinAttempted.current = true;
    setError("");
    try {
      await join.mutateAsync({ jobId });
      await utils.chat.getOverview.invalidate({ jobId });
    } catch (reason) {
      setError(errorText(reason));
    }
  }, [jobId, join, utils]);
  useEffect(() => {
    if (
      online &&
      overview.data &&
      !overview.data.joined &&
      !joinAttempted.current
    )
      void joinLobby();
  }, [online, overview.data, joinLobby]);

  // Reconnect with a bounded delay. Polling remains a fallback when streaming
  // is unavailable, and neither keeps requesting data in a hidden tab.
  useEffect(() => {
    if (
      !online ||
      !visible ||
      !overview.data?.joined ||
      accessRevoked ||
      typeof EventSource === "undefined"
    )
      return;
    let stopped = false;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1_000;
    const refresh = () => {
      void utils.chat.history.invalidate({ jobId });
      void utils.chat.getOverview.invalidate({ jobId });
    };
    const connect = () => {
      if (stopped) return;
      source = new EventSource(
        `/api/job-chat/events?jobId=${encodeURIComponent(jobId)}&after=${eventCursor.current}`,
      );
      source.addEventListener("connected", () => {
        setConnected(true);
        delay = 1_000;
        refresh();
      });
      source.addEventListener("chat-updated", (event) => {
        const cursor = Number(event.lastEventId);
        if (Number.isSafeInteger(cursor) && cursor > eventCursor.current)
          eventCursor.current = cursor;
        refresh();
      });
      source.onerror = () => {
        if (stopped) return;
        setConnected(false);
        source?.close();
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
      if (timer) clearTimeout(timer);
      setConnected(false);
    };
  }, [jobId, online, visible, overview.data?.joined, accessRevoked, utils]);

  useEffect(() => {
    if (!timeline.current || !atBottomRef.current) return;
    timeline.current.scrollTop = timeline.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (
      !online ||
      accessRevoked ||
      !visible ||
      !atBottom ||
      !history.data ||
      displayedSequence <= lastRead.current ||
      Date.now() < readRetryAfter.current
    )
      return;
    const prior = lastRead.current;
    lastRead.current = displayedSequence;
    void markRead
      .mutateAsync({ jobId, sequence: displayedSequence })
      .then(() => utils.chat.getOverview.invalidate({ jobId }))
      .catch(() => {
        lastRead.current = prior;
        readRetryAfter.current = Date.now() + 20_000;
      });
  }, [
    online,
    visible,
    atBottom,
    displayedSequence,
    history.data,
    accessRevoked,
    jobId,
    markRead,
    utils,
  ]);
  useEffect(() => {
    if (!history.data) return;
    const previous = previousLatest.current;
    const first = history.data.messages[0]?.sequence;
    const lastPrevious = previous?.messages.at(-1)?.sequence;
    if (
      previous?.messages[0] &&
      first !== undefined &&
      lastPrevious !== undefined &&
      previous.messages[0].sequence < first
    ) {
      // Retain a shifted latest page. Otherwise a busy conversation could
      // remove the messages a person is reading when its latest 50 refresh.
      setOlder((pages) => ({
        ...pages,
        [lastPrevious + 1]: previous.messages,
      }));
      setOlderCursor((cursor) =>
        cursor === undefined ? previous.nextBeforeSequence : cursor,
      );
    }
    previousLatest.current = history.data;
  }, [history.data]);

  const loadedCursors = Object.keys(older).join(",");
  useEffect(() => {
    if (!online || !visible || !loadedCursors || !history.dataUpdatedAt) return;
    let cancelled = false;
    // Refresh previously loaded history as well: edits/deletes of old messages
    // must not linger just because a new latest page arrived.
    void (async () => {
      const pages: Record<string, ChatMessage[]> = {};
      for (const cursor of loadedCursors.split(",")) {
        if (cancelled) return;
        try {
          const page = await utils.chat.history.fetch({
            jobId,
            beforeSequence: Number(cursor),
            limit: 50,
          });
          pages[cursor] = page.messages;
        } catch {
          return;
        }
      }
      if (!cancelled) setOlder((previous) => ({ ...previous, ...pages }));
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, online, visible, loadedCursors, history.dataUpdatedAt, utils]);

  // A lost send response is reconciled using its stable idempotency key.
  useEffect(() => {
    if (!draftLoaded || sendingRef.current || !draft.attempted) return;
    if (
      messages.some(
        (message) =>
          message.clientId === draft.clientId && message.author.id === userId,
      )
    )
      void clearDeliveredDraft();
  }, [
    messages,
    draftLoaded,
    draft.attempted,
    draft.clientId,
    userId,
    clearDeliveredDraft,
  ]);

  const storeMessage = (message: ChatMessage) => {
    setOlder((pages) =>
      Object.fromEntries(
        Object.entries(pages).map(([key, page]) => [
          key,
          page.map((item) => (item.id === message.id ? message : item)),
        ]),
      ),
    );
    utils.chat.history.setData({ jobId, limit: 50 }, (data) =>
      data
        ? {
            ...data,
            messages: mergeChatMessages(data.messages, [message]),
            latestSequence: Math.max(data.latestSequence, message.sequence),
          }
        : {
            messages: [message],
            nextBeforeSequence: null,
            latestSequence: message.sequence,
          },
    );
  };
  async function loadOlder() {
    if (loadingOlder || !nextBefore || !online) return;
    setLoadingOlder(true);
    setError("");
    const element = timeline.current;
    const priorHeight = element?.scrollHeight ?? 0;
    const priorTop = element?.scrollTop ?? 0;
    atBottomRef.current = false;
    setAtBottom(false);
    try {
      const page = await utils.chat.history.fetch({
        jobId,
        beforeSequence: nextBefore,
        limit: 50,
      });
      setOlder((pages) => ({ ...pages, [nextBefore]: page.messages }));
      setOlderCursor(page.nextBeforeSequence);
      requestAnimationFrame(() => {
        if (element)
          element.scrollTop = priorTop + element.scrollHeight - priorHeight;
      });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoadingOlder(false);
    }
  }
  async function sendDraft() {
    if (sendingRef.current || !online || !draftLoaded || !overview.data?.joined)
      return;
    let next = draftRef.current;
    if (!next.body.trim() && !next.attachments.length) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    try {
      for (let index = 0; index < next.attachments.length; index++) {
        const attachment = next.attachments[index]!;
        if (attachment.uploaded) continue;
        if (!attachment.file)
          throw new Error(
            `The original file ${attachment.name} could not be restored. Remove it and attach the original file again.`,
          );
        const response = await fetch(
          `/api/job-chat/attachments?jobId=${encodeURIComponent(jobId)}`,
          {
            method: "POST",
            headers: {
              "content-type": attachment.type,
              "x-file-name": encodeURIComponent(attachment.name),
            },
            body: attachment.file,
            signal: AbortSignal.timeout(60_000),
          },
        );
        const result = (await response.json()) as {
          attachment?: ChatAttachment;
          error?: string;
        };
        if (!response.ok || !result.attachment)
          throw new Error(
            result.error ?? `Could not upload ${attachment.name}.`,
          );
        next = {
          ...next,
          attachments: next.attachments.map((item, position) =>
            position === index
              ? { ...item, uploaded: result.attachment }
              : item,
          ),
        };
        changeDraft(next);
      }
      next = { ...next, attempted: true };
      changeDraft(next);
      await saveChatDraft(draftKey, next).catch(() => setStorageError(true));
      const message = await send.mutateAsync({
        jobId,
        clientId: next.clientId,
        body: next.body,
        replyToId: next.replyToId,
        attachmentIds: next.attachments.map((file) => file.uploaded!.id),
      });
      storeMessage(message);
      await clearDeliveredDraft();
      atBottomRef.current = true;
      setAtBottom(true);
      requestAnimationFrame(() => {
        if (timeline.current)
          timeline.current.scrollTop = timeline.current.scrollHeight;
        composer.current?.focus();
      });
      void utils.chat.getOverview.invalidate({ jobId });
    } catch (reason) {
      const code =
        reason && typeof reason === "object" && "data" in reason
          ? (reason.data as { code?: string } | null)?.code
          : undefined;
      if (
        next.attempted &&
        (code === "BAD_REQUEST" || code === "TOO_MANY_REQUESTS")
      ) {
        // These responses prove the atomic send was rejected. Network and
        // internal failures remain locked to the exact payload until retried.
        const expiredAttachments =
          code === "BAD_REQUEST" && /attachment/i.test(errorText(reason));
        if (expiredAttachments) {
          for (const attachment of next.attachments)
            if (attachment.uploaded) {
              void fetch(attachment.uploaded.url, {
                method: "DELETE",
                signal: AbortSignal.timeout(20_000),
              }).catch(() => {
                /* Expired server uploads are also cleaned by retention. */
              });
            }
        }
        next = {
          ...next,
          attempted: false,
          attachments: expiredAttachments
            ? next.attachments.map((attachment) => ({
                ...attachment,
                uploaded: undefined,
              }))
            : next.attachments,
        };
        changeDraft(next);
      }
      setError(
        `${errorText(reason)} Your unsent message is kept here.${next.attempted ? " Retry to check delivery safely." : ""}`,
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }
  function chooseFiles(files: FileList | null) {
    if (!files || draft.attempted) return;
    const chosen = [...files];
    if (draft.attachments.length + chosen.length > 5) {
      setError("Attach up to five photos or PDFs per message.");
      return;
    }
    if (
      chosen.some(
        (file) =>
          !ALLOWED_FILES.has(file.type) ||
          file.size > MAX_FILE_SIZE ||
          file.size === 0,
      )
    ) {
      setError("Choose JPEG, PNG, WebP, GIF or PDF files, up to 10 MB each.");
      return;
    }
    changeDraft({
      ...draft,
      attachments: [
        ...draft.attachments,
        ...chosen.map((file) => ({
          localId: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          file,
        })),
      ],
    });
    setError("");
  }
  async function removeAttachment(localId: string) {
    const attachment = draft.attachments.find(
      (file) => file.localId === localId,
    );
    if (!attachment || sending || draft.attempted) return;
    if (attachment.uploaded) {
      try {
        const response = await fetch(attachment.uploaded.url, {
          method: "DELETE",
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok && response.status !== 404)
          throw new Error(
            "Could not remove the uploaded attachment. Reconnect and try again.",
          );
      } catch (reason) {
        setError(errorText(reason));
        return;
      }
    }
    changeDraft({
      ...draft,
      attachments: draft.attachments.filter((file) => file.localId !== localId),
    });
  }
  function replyTo(message: ChatMessage) {
    changeDraft({
      ...draftRef.current,
      replyToId: message.id,
      replyName: message.author.name,
      replyBody: message.body || "Attachment",
    });
    composer.current?.focus();
  }
  async function deleteMessage(message: ChatMessage) {
    if (
      !(await confirmAction({
        title: "Delete this message?",
        description: "It will be removed for everyone in the job.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync({ jobId, messageId: message.id });
      storeMessage({
        ...message,
        body: "",
        attachments: [],
        deletedAt: new Date(),
      });
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  const lockedComposer = !draftLoaded || sending || draft.attempted;
  const currentError =
    error || (overview.error?.message ?? history.error?.message);
  const accessError = [overview.error, history.error].find(
    (failure) =>
      failure?.data?.code === "FORBIDDEN" ||
      failure?.data?.code === "UNAUTHORIZED" ||
      failure?.data?.code === "NOT_FOUND",
  );
  if (accessError)
    return (
      <p
        role="alert"
        className="text-destructive rounded-lg border p-4 text-sm"
      >
        {accessError.message}
      </p>
    );
  return (
    <section
      ref={panel}
      aria-label="Job chat"
      className="bg-card flex h-full min-h-0 w-full flex-col overflow-hidden"
      style={{ height: panelHeight }}
    >
      <header
        className="min-h-0 shrink space-y-2 overflow-y-auto px-3 py-2 text-white sm:px-4"
        style={EXPANDED_METAL}
      >
        <div className="flex items-center justify-between gap-2">
          <h1 className="truncate text-lg font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
            Chat
          </h1>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={ON_METAL}
              onClick={() => {
                setShowMembers(!showMembers);
                setShowBell(false);
              }}
              aria-label="People"
              aria-expanded={showMembers}
            >
              <UsersIcon className="h-4 w-4" />
              <span className="hidden sm:inline">People</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={ON_METAL}
              aria-label="Notifications"
              aria-expanded={showBell}
              onClick={() => {
                setShowBell(!showBell);
                setShowMembers(false);
              }}
            >
              {overview.data?.muted ? (
                <BellOffIcon className="h-4 w-4" />
              ) : (
                <BellRingIcon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        {showBell && (
          <div
            className="bg-card text-card-foreground space-y-3 rounded-md p-3 text-sm shadow-md"
            aria-label="Notification settings"
          >
            <ChatNotifications />
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 disabled:opacity-50"
              aria-pressed={overview.data?.muted === true}
              disabled={!online || !overview.data?.joined || mute.isPending}
              onClick={() => {
                void mute
                  .mutateAsync({ jobId, muted: !overview.data?.muted })
                  .then(() => utils.chat.getOverview.invalidate({ jobId }))
                  .catch((reason: unknown) => setError(errorText(reason)));
              }}
            >
              {overview.data?.muted ? (
                <BellRingIcon className="h-4 w-4" />
              ) : (
                <BellOffIcon className="h-4 w-4" />
              )}
              {overview.data?.muted ? "Unmute this job" : "Mute this job"}
            </button>
          </div>
        )}
        {showMembers && (
          <div
            className="bg-card text-card-foreground max-h-40 overflow-y-auto rounded-md p-2 text-sm shadow-md"
            aria-label="Job members"
          >
            {members.isLoading ? (
              <p>Loading people…</p>
            ) : members.error ? (
              <p role="alert">{members.error.message}</p>
            ) : (
              <ul>
                {members.data?.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-2 py-1"
                  >
                    <span>
                      {member.name}
                      {member.id === userId ? " (you)" : ""}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {member.joined ? "In chat" : "On this job"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </header>
      <AngleTrim edge="top" />
      {!online && (
        <p className="flex shrink-0 items-center gap-2 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <WifiOffIcon className="h-4 w-4" />
          Reconnect, then press Send or Retry. Your draft stays here.
        </p>
      )}
      {online && overview.data && !overview.data.joined && (
        <div className="p-3">
          <Button onClick={() => void joinLobby()} disabled={join.isPending}>
            {join.isPending ? "Joining…" : "Join job chat"}
          </Button>
        </div>
      )}
      <div
        ref={timeline}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4"
        style={CHECKER_PLATE}
        aria-label="Messages"
        onScroll={(event) => {
          const bottom = nearBottom(event.currentTarget);
          atBottomRef.current = bottom;
          setAtBottom(bottom);
        }}
      >
        {nextBefore != null && (
          <div className="mb-4 text-center">
            <Button
              variant="outline"
              size="sm"
              className="shadow-sm"
              disabled={loadingOlder || !online}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </Button>
          </div>
        )}
        {history.isLoading && online && (
          <p role="status" className="text-center">
            <span className="rounded-full bg-black/35 px-3 py-1 text-sm text-white">
              Loading messages…
            </span>
          </p>
        )}
        {!history.isLoading && !messages.length && (
          <div className="py-12 text-center">
            <p className="bg-card/90 inline-block rounded-xl px-4 py-3 text-sm shadow-sm">
              No messages yet. Share a job update, a photo or a question.
            </p>
          </div>
        )}
        {messages.map((message, index) => {
          const createdAt = new Date(message.createdAt);
          const previous = messages[index - 1];
          const showTimestamp =
            !previous ||
            createdAt.getTime() - new Date(previous.createdAt).getTime() >=
              10 * 60 * 1000;
          const mine = message.author.id === userId;
          // Consecutive messages from one person read as a single group.
          const grouped =
            !showTimestamp && previous?.author.id === message.author.id;
          return (
            <Fragment key={message.id}>
              {showTimestamp && (
                <div className="my-3 text-center first:mt-0">
                  <time
                    dateTime={createdAt.toISOString()}
                    title={createdAt.toLocaleString()}
                    className="rounded-full bg-black/35 px-2.5 py-0.5 text-[11px] font-medium text-white"
                  >
                    {createdAt.toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              )}
              <ChatBubble
                message={message}
                mine={mine}
                grouped={grouped}
                replied={
                  message.replyToId
                    ? messages.find((item) => item.id === message.replyToId)
                    : undefined
                }
                onActions={() => setActionsFor(message)}
              />
            </Fragment>
          );
        })}
      </div>
      {actionsFor && (
        <MessageActions
          message={actionsFor}
          canReply={!lockedComposer && !actionsFor.deletedAt}
          canDelete={
            online &&
            !remove.isPending &&
            !actionsFor.deletedAt &&
            (actionsFor.author.id === userId ||
              overview.data?.canModerate === true)
          }
          onClose={() => setActionsFor(null)}
          onReply={() => replyTo(actionsFor)}
          onDelete={() => void deleteMessage(actionsFor)}
        />
      )}
      {!atBottom && (
        <button
          className="bg-primary/5 text-primary shrink-0 border-y px-3 py-2 text-sm font-medium"
          onClick={() => {
            if (timeline.current)
              timeline.current.scrollTop = timeline.current.scrollHeight;
            atBottomRef.current = true;
            setAtBottom(true);
          }}
        >
          Jump to latest messages ↓
        </button>
      )}
      <AngleTrim edge="bottom" />
      <footer
        className="max-h-full min-h-0 shrink overflow-y-auto px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={EXPANDED_METAL}
      >
        {currentError && (
          <p role="alert" className="bg-card text-destructive mb-2 rounded-md px-2 py-1 text-sm">
            {currentError}
          </p>
        )}
        {storageError && (
          <p role="alert" className="bg-card mb-2 rounded-md px-2 py-1 text-xs text-amber-700">
            Draft storage is unavailable on this device. Keep this screen open
            until your message is sent.
          </p>
        )}
        {draft.attempted && !sending && (
          <p className="bg-card text-muted-foreground mb-2 rounded-md px-2 py-1 text-xs">
            Delivery is not confirmed. Retry keeps the same message ID to
            prevent duplicates.
          </p>
        )}
        {draft.replyToId && (
          <div className="bg-card text-card-foreground mb-2 flex items-start gap-2 rounded p-2 text-xs">
            <ReplyIcon className="h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <strong>Replying to {draft.replyName}</strong>
              <p className="line-clamp-2">{draft.replyBody}</p>
            </div>
            <button
              aria-label="Cancel reply"
              disabled={Boolean(lockedComposer)}
              onClick={() =>
                changeDraft({
                  ...draft,
                  replyToId: undefined,
                  replyName: undefined,
                  replyBody: undefined,
                })
              }
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        )}
        {!!draft.attachments.length && (
          <ul className="mb-2 flex flex-wrap gap-2">
            {draft.attachments.map((file) => (
              <li
                key={file.localId}
                className="bg-card text-card-foreground flex max-w-full items-center gap-2 rounded border px-2 py-1 text-xs"
              >
                <PaperclipIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{file.name}</span>
                <button
                  aria-label={`Remove ${file.name}`}
                  disabled={Boolean(lockedComposer)}
                  onClick={() => void removeAttachment(file.localId)}
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendDraft();
          }}
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
            multiple
            className="hidden"
            aria-label="Attach photos or PDFs"
            onChange={(event) => {
              chooseFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={ON_METAL}
            aria-label="Attach photos or PDFs"
            disabled={Boolean(lockedComposer) || draft.attachments.length >= 5}
            onClick={() => fileInput.current?.click()}
          >
            <PaperclipIcon className="h-5 w-5" />
          </Button>
          <textarea
            ref={composer}
            aria-label="Message"
            placeholder="Message everyone on this job…"
            className="bg-background focus-visible:ring-ring max-h-36 min-h-12 min-w-0 flex-1 resize-y rounded-lg border px-3 py-[11px] text-base leading-6 shadow-[0_3px_8px_rgba(0,0,0,0.5)] focus-visible:ring-2"
            maxLength={8000}
            rows={1}
            value={draft.body}
            disabled={Boolean(lockedComposer)}
            onChange={(event) =>
              changeDraft({ ...draft, body: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void sendDraft();
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            className="size-12 shadow-[0_3px_8px_rgba(0,0,0,0.5)]"
            aria-label={draft.attempted ? "Retry message" : "Send message"}
            disabled={
              !online ||
              !draftLoaded ||
              sending ||
              !overview.data?.joined ||
              (!draft.body.trim() && !draft.attachments.length)
            }
          >
            {sending ? (
              <Loader2Icon className="h-5 w-5 animate-spin" />
            ) : (
              <SendIcon className="h-5 w-5" />
            )}
          </Button>
        </form>
      </footer>
    </section>
  );
}

function ChatBubble({
  message,
  mine,
  grouped,
  replied,
  onActions,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  replied: ChatMessage | undefined;
  onActions: () => void;
}) {
  // Deleted messages have nothing to reply to, copy or delete.
  const press = useLongPress(() => {
    if (!message.deletedAt) onActions();
  });
  return (
    <article
      id={`chat-message-${message.id}`}
      className={`flex ${mine ? "justify-end" : "justify-start"} ${grouped ? "mt-1" : "mt-3"}`}
    >
      <div
        {...press}
        tabIndex={0}
        aria-haspopup="menu"
        aria-label={`Message from ${mine ? "you" : message.author.name}. Press and hold for options.`}
        className={`focus-visible:ring-ring max-w-[85%] min-w-0 cursor-default rounded-2xl px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.25)] transition-transform outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 active:scale-[0.99] sm:max-w-[70%] ${
          mine
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-card text-card-foreground rounded-bl-md"
        }`}
      >
        {!mine && !grouped && (
          <p className="text-primary mb-0.5 text-xs font-semibold">
            {message.author.name}
          </p>
        )}
        {message.deletedAt ? (
          <p className="text-sm italic opacity-70">Message deleted</p>
        ) : (
          <>
            {message.replyToId && (
              <div
                className={`mb-1.5 rounded-md border-l-[3px] px-2 py-1 text-xs ${
                  mine
                    ? "border-primary-foreground/70 bg-black/15"
                    : "border-primary bg-muted"
                }`}
              >
                {replied ? (
                  <>
                    <strong>{replied.author.name}</strong>
                    <p className="line-clamp-2 opacity-80">
                      {replied.deletedAt
                        ? "Message deleted"
                        : replied.body || "Attachment"}
                    </p>
                  </>
                ) : (
                  <span className="opacity-80">Reply to an earlier message</span>
                )}
              </div>
            )}
            {message.body && (
              <p className="text-[15px] leading-snug [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
                {message.body}
              </p>
            )}
            {message.attachments.length > 0 && (
              <div className={`grid gap-2 ${message.body ? "mt-2" : ""}`}>
                {message.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    draggable={false}
                    className="bg-background text-foreground block overflow-hidden rounded-lg text-sm"
                    aria-label={`Open ${attachment.name}`}
                  >
                    {attachment.mimeType.startsWith("image/") ? (
                      <img
                        src={attachment.url}
                        alt={attachment.name}
                        draggable={false}
                        className="max-h-72 max-w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex items-center gap-2 p-3">
                        <FileIcon className="h-5 w-5 shrink-0" />
                        {attachment.name}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function MessageActions({
  message,
  canReply,
  canDelete,
  onClose,
  onReply,
  onDelete,
}: {
  message: ChatMessage;
  canReply: boolean;
  canDelete: boolean;
  onClose: () => void;
  onReply: () => void;
  onDelete: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const item =
    "flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-base font-medium outline-none hover:bg-accent focus-visible:bg-accent disabled:opacity-40";
  const canCopy = Boolean(message.body) && !message.deletedAt;
  // Portalled so the backdrop also covers the app bar above the chat panel.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        role="menu"
        aria-label="Message options"
        className="bg-card w-full max-w-sm rounded-t-2xl p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {message.body && (
          <p className="text-muted-foreground line-clamp-3 border-b px-4 pt-2 pb-3 text-sm">
            {message.body}
          </p>
        )}
        <button
          ref={first}
          type="button"
          role="menuitem"
          className={item}
          disabled={!canReply}
          onClick={() => {
            onClose();
            onReply();
          }}
        >
          <ReplyIcon className="h-5 w-5" /> Reply
        </button>
        {canCopy && (
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onClose();
              void navigator.clipboard?.writeText(message.body);
            }}
          >
            <CopyIcon className="h-5 w-5" /> Copy text
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            role="menuitem"
            className={`${item} text-destructive`}
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <Trash2Icon className="h-5 w-5" /> Delete
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
