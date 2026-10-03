"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BellOffIcon,
  BellRingIcon,
  FileIcon,
  Loader2Icon,
  PaperclipIcon,
  ReplyIcon,
  SendIcon,
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

export function JobChatView({
  jobId,
  jobName,
}: {
  jobId: string;
  jobName?: string;
}) {
  const { userId, isLoaded } = useAuth();
  if (!isLoaded)
    return (
      <p role="status" className="p-4">
        Loading chat…
      </p>
    );
  if (!userId) return <p className="p-4">Sign in to open job chat.</p>;
  return (
    <ChatLobby
      key={`${userId}:${jobId}`}
      jobId={jobId}
      jobName={jobName}
      userId={userId}
    />
  );
}

function ChatLobby({
  jobId,
  jobName,
  userId,
}: {
  jobId: string;
  jobName?: string;
  userId: string;
}) {
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
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(
    null,
  );
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
  const edit = api.chat.edit.useMutation();
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
      const height = viewport?.height ?? window.innerHeight;
      const top =
        panel.current.getBoundingClientRect().top - (viewport?.offsetTop ?? 0);
      setPanelHeight(
        Math.max(180, Math.min(864, height - Math.max(0, top) - 8)),
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
  async function editMessage() {
    if (!editing || !online) return;
    try {
      const message = await edit.mutateAsync({
        jobId,
        messageId: editing.id,
        body: editing.body,
      });
      storeMessage(message);
      setEditing(null);
    } catch (reason) {
      setError(errorText(reason));
    }
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
  const displayJobName = jobName ?? overview.data?.jobName;

  return (
    <section
      ref={panel}
      aria-label="Job chat"
      className="bg-card flex min-h-0 flex-col overflow-hidden rounded-xl border"
      style={{
        height: panelHeight ?? "calc(100dvh - 10rem)",
        maxHeight: "54rem",
      }}
    >
      <header className="shrink-0 space-y-2 border-b px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">
              {displayJobName ? `${displayJobName} · Chat` : "Job chat"}
            </h1>
            <p className="text-muted-foreground text-xs">
              {!online
                ? "Offline · messages are not being sent"
                : connected
                  ? "Live job conversation"
                  : "Checking for new messages"}
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowMembers(!showMembers)}
              aria-expanded={showMembers}
            >
              <UsersIcon className="h-4 w-4" />
              <span className="hidden sm:inline">People</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={
                overview.data?.muted ? "Unmute this job" : "Mute this job"
              }
              disabled={!online || !overview.data?.joined || mute.isPending}
              onClick={() => {
                void mute
                  .mutateAsync({ jobId, muted: !overview.data?.muted })
                  .then(() => utils.chat.getOverview.invalidate({ jobId }))
                  .catch((reason: unknown) => setError(errorText(reason)));
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
        <ChatNotifications />
        {overview.data?.muted && (
          <p className="text-muted-foreground text-xs">
            Notifications are muted for this job.
          </p>
        )}
        {showMembers && (
          <div
            className="bg-muted/40 max-h-40 overflow-y-auto rounded-md p-2 text-sm"
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
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4"
        aria-label="Messages"
        onScroll={(event) => {
          const bottom = nearBottom(event.currentTarget);
          atBottomRef.current = bottom;
          setAtBottom(bottom);
        }}
      >
        {nextBefore != null && (
          <div className="text-center">
            <Button
              variant="outline"
              size="sm"
              disabled={loadingOlder || !online}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </Button>
          </div>
        )}
        {history.isLoading && online && (
          <p
            role="status"
            className="text-muted-foreground text-center text-sm"
          >
            Loading messages…
          </p>
        )}
        {!history.isLoading && !messages.length && (
          <div className="text-muted-foreground py-12 text-center">
            <p>No messages loaded yet.</p>
            <p className="mt-1 text-sm">
              Share a job update, a photo or a question.
            </p>
          </div>
        )}
        {messages.map((message) => {
          const mine = message.author.id === userId;
          const mayChange = mine || overview.data?.canModerate === true;
          const replied = message.replyToId
            ? messages.find((item) => item.id === message.replyToId)
            : null;
          return (
            <article
              key={message.id}
              id={`chat-message-${message.id}`}
              className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}
            >
              <div
                className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
                aria-hidden="true"
              >
                {message.author.image ? (
                  <img
                    src={message.author.image}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  message.author.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <div
                className={`max-w-[88%] min-w-0 rounded-xl px-3 py-2 sm:max-w-[80%] ${mine ? "bg-primary/10" : "bg-muted/60"}`}
              >
                <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-semibold">
                    {mine ? "You" : message.author.name}
                  </span>
                  <time
                    className="text-muted-foreground"
                    dateTime={new Date(message.createdAt).toISOString()}
                    title={new Date(message.createdAt).toLocaleString()}
                  >
                    {new Date(message.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  {message.editedAt && (
                    <span className="text-muted-foreground">edited</span>
                  )}
                </div>
                {message.deletedAt ? (
                  <p className="text-muted-foreground text-sm italic">
                    Message deleted
                  </p>
                ) : (
                  <>
                    {message.replyToId && (
                      <div className="border-primary/40 text-muted-foreground mb-2 border-l-2 pl-2 text-xs">
                        {replied ? (
                          <>
                            <strong>{replied.author.name}</strong>
                            <p className="line-clamp-2">
                              {replied.deletedAt
                                ? "Message deleted"
                                : replied.body || "Attachment"}
                            </p>
                          </>
                        ) : (
                          "Reply to an earlier message"
                        )}
                      </div>
                    )}
                    {editing?.id === message.id ? (
                      <div className="space-y-2">
                        <textarea
                          className="bg-background min-h-20 w-full rounded border p-2 text-base"
                          aria-label="Edit message"
                          maxLength={8000}
                          value={editing.body}
                          onChange={(event) =>
                            setEditing({ ...editing, body: event.target.value })
                          }
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void editMessage()}
                            disabled={
                              edit.isPending || !online || !editing.body.trim()
                            }
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap">
                        {message.body}
                      </p>
                    )}
                    {message.attachments.length > 0 && (
                      <div className="mt-2 grid gap-2">
                        {message.attachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href={attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-background block overflow-hidden rounded-lg border text-sm"
                            aria-label={`Open ${attachment.name}`}
                          >
                            {attachment.mimeType.startsWith("image/") ? (
                              <img
                                src={attachment.url}
                                alt={attachment.name}
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
                    <div className="text-muted-foreground mt-1 flex flex-wrap gap-3 text-xs">
                      <button
                        type="button"
                        className="hover:text-foreground min-h-8"
                        disabled={Boolean(lockedComposer)}
                        onClick={() => {
                          changeDraft({
                            ...draft,
                            replyToId: message.id,
                            replyName: message.author.name,
                            replyBody: message.body || "Attachment",
                          });
                          composer.current?.focus();
                        }}
                      >
                        Reply
                      </button>
                      {mayChange && (
                        <>
                          <button
                            type="button"
                            className="hover:text-foreground min-h-8"
                            disabled={!online || edit.isPending}
                            onClick={() =>
                              setEditing({ id: message.id, body: message.body })
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="hover:text-destructive min-h-8"
                            disabled={!online || remove.isPending}
                            onClick={() => void deleteMessage(message)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
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
      <footer className="bg-card shrink-0 border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {currentError && (
          <p role="alert" className="text-destructive mb-2 text-sm">
            {currentError}
          </p>
        )}
        {storageError && (
          <p role="alert" className="mb-2 text-xs text-amber-700">
            Draft storage is unavailable on this device. Keep this screen open
            until your message is sent.
          </p>
        )}
        {draft.attempted && !sending && (
          <p className="text-muted-foreground mb-2 text-xs">
            Delivery is not confirmed. Retry keeps the same message ID to
            prevent duplicates.
          </p>
        )}
        {draft.replyToId && (
          <div className="bg-muted/50 mb-2 flex items-start gap-2 rounded p-2 text-xs">
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
                className="flex max-w-full items-center gap-2 rounded border px-2 py-1 text-xs"
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
            className="bg-background focus-visible:ring-ring max-h-36 min-h-11 min-w-0 flex-1 resize-y rounded-lg border px-3 py-2 text-base focus-visible:ring-2"
            maxLength={8000}
            rows={2}
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
