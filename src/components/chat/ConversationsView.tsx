"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  BellRingIcon,
  ListIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  ExternalLinkIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import { ChatNotifications } from "~/components/jobs/ChatNotifications";
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
  uploadConversationFile,
  removePendingConversationFile,
} from "~/lib/conversation-upload";
import type { ConversationMessage } from "~/server/conversations/contracts";
import { safeSnapshotHref } from "~/lib/snapshot-source";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useReplicacheJobsList } from "~/hooks/use-replicache-jobs";
import { ChatNavigation, type ChatDestination } from "./ChatNavigation";
import {
  AngleTrim,
  CHAT_COLUMN,
  CHECKER_PLATE,
  EXPANDED_METAL,
  ON_METAL,
} from "./ChatChrome";
const JobChatThread = dynamic(
  () =>
    import("~/components/jobs/JobChatThread").then(
      (module) => module.JobChatThread,
    ),
  {
    loading: () => (
      <p role="status" className="p-4">
        Loading job chat…
      </p>
    ),
  },
);
const text = (reason: unknown) =>
  reason instanceof Error
    ? reason.message
    : "Could not complete this action. Try again.";
type ConversationDraft = {
  body: string;
  files: ConversationMessage["attachments"];
  attempt: { clientId: string; body: string; attachmentIds: string[] } | null;
};
export function ConversationsView({ initialJobId }: { initialJobId?: string }) {
  const router = useRouter(),
    params = useSearchParams(),
    online = useOnlineStatus(),
    utils = api.useUtils();
  const jobs = useReplicacheJobsList();
  const [newOpen, setNewOpen] = useState(false),
    [chatsOpen, setChatsOpen] = useState(false),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [target, setTarget] = useState<ChatTarget>({
      mode: "direct",
      recipientIds: [],
      name: "",
    }),
    [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const drafts = useMemo(() => new Map<string, ConversationDraft>(), []);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const resize = () => {
      if (!panel.current) return;
      const viewport = window.visualViewport;
      setHeight(
        Math.max(
          0,
          (viewport?.offsetTop ?? 0) +
            (viewport?.height ?? innerHeight) -
            panel.current.getBoundingClientRect().top,
        ),
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
  const conversationId = params.get("conversation");
  const jobId = conversationId ? null : (params.get("job") ?? initialJobId);
  const selected: ChatDestination | null = conversationId
    ? { kind: "conversation", id: conversationId }
    : jobId
      ? { kind: "job", id: jobId }
      : null;
  const list = api.conversations.list.useQuery(undefined, {
    enabled: online,
    refetchInterval: online ? 5000 : false,
  });
  const create = api.conversations.create.useMutation();
  const current = list.data?.conversations.find(
    (chat) => chat.id === conversationId,
  );
  const job = jobs.find((item) => item.id === jobId);
  const availableJobs: { id: string; name: string }[] = jobs
    .filter((item) =>
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.id),
    )
    .map(({ id, name }) => ({ id, name }));
  if (jobId && !availableJobs.some((item) => item.id === jobId))
    availableJobs.unshift({
      id: jobId,
      name: "Current job",
    });
  const choose = (chat: ChatDestination) => {
    setChatsOpen(false);
    router.push(
      `/dashboard/chat?${chat.kind === "job" ? "job" : "conversation"}=${encodeURIComponent(chat.id)}`,
      { scroll: false },
    );
  };
  const start = async () => {
    if (!validChatTarget(target)) return;
    setError("");
    try {
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
      await utils.conversations.list.invalidate();
      setNewOpen(false);
      choose({ kind: "conversation", id });
    } catch (reason) {
      setError(text(reason));
    }
  };
  const navigation = (
    <ChatNavigation
      conversations={list.data?.conversations ?? []}
      jobs={availableJobs}
      selected={selected}
      onSelect={choose}
      loading={list.isLoading}
    />
  );
  return (
    <section
      ref={panel}
      aria-label="Chat workspace"
      className="bg-card fixed inset-x-0 top-14 bottom-0 z-30 flex min-h-0 flex-col overflow-hidden sm:top-16"
      style={{ height }}
    >
      <header
        className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-white sm:px-4"
        style={EXPANDED_METAL}
      >
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <MessageSquareIcon className="size-5" />
          Chat
        </h1>
        <div className="flex items-center gap-2">
          {selected && (
            <Button
              variant="ghost"
              size="sm"
              className={`${ON_METAL} md:hidden`}
              aria-label="Switch chat"
              aria-expanded={chatsOpen}
              onClick={() => setChatsOpen(true)}
            >
              <ListIcon className="size-4" />
              Chats
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={ON_METAL}
            aria-label="Device notifications"
            title="Device notifications"
            onClick={() => setNotificationsOpen(true)}
          >
            <BellRingIcon className="size-4" />
          </Button>
          <Button
            size="sm"
            disabled={!online}
            onClick={() => {
              setError("");
              setTarget({ mode: "direct", recipientIds: [], name: "" });
              setNewOpen(true);
            }}
          >
            <PlusIcon className="size-4" />
            New chat
          </Button>
        </div>
      </header>
      {!online && (
        <p role="status" className="bg-muted shrink-0 px-4 py-2 text-sm">
          Reconnect to send messages. You can still view cached chats and keep
          your draft.
        </p>
      )}
      {list.error && (
        <p role="alert" className="text-destructive shrink-0 px-4 py-2 text-sm">
          Could not load chats.{" "}
          <button className="underline" onClick={() => void list.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Chat list"
          className={`${selected ? "hidden md:flex" : "flex"} min-h-0 w-full shrink-0 flex-col border-r md:w-72`}
        >
          {navigation}
        </aside>
        <main
          aria-label="Current chat"
          className={`${selected ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col`}
        >
          {selected ? (
            <>
              <header className="bg-card flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">
                    {jobId
                      ? (job?.name ?? "Job chat")
                      : (current?.name ?? "Conversation")}
                  </h2>
                  <p className="text-muted-foreground truncate text-xs">
                    {jobId
                      ? "Job team"
                      : current?.kind === "direct"
                        ? "Direct chat"
                        : current?.members
                            .map((member) => member.name)
                            .join(", ")}
                  </p>
                </div>
              </header>
              {jobId ? (
                <JobChatThread
                  key={jobId}
                  jobId={jobId}
                  embedded
                  userId={list.data?.userId}
                />
              ) : (
                conversationId && (
                  <ConversationThread
                    key={`${list.data?.userId}:${conversationId}`}
                    id={conversationId}
                    userId={list.data?.userId}
                    online={online}
                    drafts={drafts}
                  />
                )
              )}
            </>
          ) : (
            <div
              className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
              style={CHECKER_PLATE}
            >
              <div className="bg-card text-card-foreground max-w-sm rounded-xl px-6 py-5 shadow-sm">
                <MessageSquareIcon className="text-primary mx-auto mb-3 size-8" />
                <p className="font-medium">Your conversations, in one place</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Choose a direct, group or job chat from the list.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
      <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <DialogContent>
          <DialogTitle>Device notifications</DialogTitle>
          <DialogDescription>
            Manage chat notifications on this device.
          </DialogDescription>
          <ChatNotifications />
        </DialogContent>
      </Dialog>
      <Dialog open={chatsOpen} onOpenChange={setChatsOpen}>
        <DialogContent className="flex max-h-[85dvh] min-h-0 flex-col gap-1 p-3">
          <DialogTitle className="px-1 pt-1 pr-8">Switch chat</DialogTitle>
          <DialogDescription className="px-1 text-sm">
            Choose a direct, group or job chat.
          </DialogDescription>
          <div className="min-h-0 flex-1 overflow-hidden">{navigation}</div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={newOpen}
        onOpenChange={(open) => {
          if (!create.isPending) setNewOpen(open);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>
            Choose a person or name a group. Only the selected people can access
            the conversation.
          </DialogDescription>
          <RecipientChooser
            value={target}
            onChange={setTarget}
            disabled={create.isPending}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button
            disabled={!validChatTarget(target) || create.isPending}
            onClick={() => void start()}
          >
            {create.isPending ? "Starting…" : "Start chat"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ConversationThread({
  id,
  userId,
  online,
  drafts,
}: {
  id: string;
  userId?: string;
  online: boolean;
  drafts: Map<string, ConversationDraft>;
}) {
  const draftKey = `${userId}:${id}`;
  const cached = drafts.get(draftKey);
  const utils = api.useUtils(),
    [body, setBody] = useState(cached?.body ?? ""),
    [files, setFiles] = useState<ConversationMessage["attachments"]>(
      cached?.files ?? [],
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(Boolean(cached?.attempt)),
    [older, setOlder] = useState<ConversationMessage[]>([]),
    [cursor, setCursor] = useState<number | null | undefined>(),
    [loadingOlder, setLoadingOlder] = useState(false);
  const history = api.conversations.history.useQuery(
    { conversationId: id, limit: 50 },
    { enabled: online, refetchInterval: online ? 3000 : false, retry: 1 },
  );
  const send = api.conversations.send.useMutation(),
    remove = api.conversations.remove.useMutation(),
    read = api.conversations.markRead.useMutation();
  const attempt = useRef<{
      clientId: string;
      body: string;
      attachmentIds: string[];
    } | null>(cached?.attempt ?? null),
    fileInput = useRef<HTMLInputElement>(null),
    timeline = useRef<HTMLDivElement>(null),
    lastRead = useRef(0),
    tail = useRef(""),
    bottom = useRef(true);
  useEffect(() => {
    drafts.set(draftKey, { body, files, attempt: attempt.current });
  }, [drafts, draftKey, body, files, busy, locked]);
  const messages = [
    ...new Map(
      [...older, ...(history.data?.messages ?? [])].map((m) => [m.id, m]),
    ).values(),
  ].sort((a, b) => a.sequence - b.sequence);
  const latest = messages.at(-1)?.sequence ?? 0,
    next = cursor === undefined ? history.data?.nextBeforeSequence : cursor;
  useEffect(() => {
    if (
      !online ||
      !latest ||
      latest <= lastRead.current ||
      document.visibilityState === "hidden"
    )
      return;
    lastRead.current = latest;
    void read
      .mutateAsync({ conversationId: id, sequence: latest })
      .then(() => utils.conversations.list.invalidate())
      .catch(() => {
        lastRead.current = 0;
      });
  }, [id, latest, online, read, utils]);
  useEffect(() => {
    const last = messages.at(-1)?.id ?? "";
    if (last !== tail.current && timeline.current && bottom.current)
      timeline.current.scrollTop = timeline.current.scrollHeight;
    tail.current = last;
  }, [messages]);
  const submit = async () => {
    if (busy || !online || (!body.trim() && !files.length)) return;
    setBusy(true);
    setLocked(true);
    setError("");
    attempt.current ??= {
      clientId: crypto.randomUUID(),
      body: body.trim(),
      attachmentIds: files.map((f) => f.id),
    };
    try {
      await send.mutateAsync({ conversationId: id, ...attempt.current });
      attempt.current = null;
      drafts.delete(draftKey);
      setLocked(false);
      setBody("");
      setFiles([]);
      bottom.current = true;
      await Promise.all([
        utils.conversations.history.invalidate({ conversationId: id }),
        utils.conversations.list.invalidate(),
      ]);
    } catch (reason) {
      setError(text(reason));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (selected: FileList | null) => {
    if (!selected || busy || locked) return;
    setBusy(true);
    setError("");
    try {
      if (files.length + selected.length > 5)
        throw new Error("Attach up to five files per message.");
      for (const file of Array.from(selected)) {
        const uploaded = await uploadConversationFile(id, file);
        setFiles((current) => [...current, uploaded]);
      }
    } catch (reason) {
      setError(text(reason));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const loadOlder = async () => {
    if (!next || loadingOlder) return;
    setLoadingOlder(true);
    const top = timeline.current?.scrollTop ?? 0,
      height = timeline.current?.scrollHeight ?? 0;
    try {
      const page = await utils.conversations.history.fetch({
        conversationId: id,
        beforeSequence: next,
        limit: 50,
      });
      setOlder((current) => [...page.messages, ...current]);
      setCursor(page.nextBeforeSequence);
      requestAnimationFrame(() => {
        if (timeline.current)
          timeline.current.scrollTop =
            top + timeline.current.scrollHeight - height;
      });
    } catch (reason) {
      setError(text(reason));
    } finally {
      setLoadingOlder(false);
    }
  };
  const denied = ["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"].includes(
    history.error?.data?.code ?? "",
  );
  return (
    <>
      <div
        ref={timeline}
        role="log"
        aria-label="Messages"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
        style={CHECKER_PLATE}
        onScroll={() => {
          if (timeline.current)
            bottom.current =
              timeline.current.scrollHeight -
                timeline.current.scrollTop -
                timeline.current.clientHeight <
              80;
        }}
      >
        <div className={`${CHAT_COLUMN} space-y-3`}>
          {history.isLoading && (
            <p role="status" className="bg-card rounded-md p-3 text-sm">
              Loading messages…
            </p>
          )}
          {next && (
            <Button
              variant="outline"
              size="sm"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </Button>
          )}
          {history.error && (
            <p role="alert" className="text-destructive">
              {denied
                ? "This conversation is unavailable."
                : "Could not load messages. Check your connection."}
            </p>
          )}
          {!denied &&
            messages.map((m) => (
              <article
                key={m.id}
                aria-label={`Message from ${m.author.name}`}
                className={`max-w-[85%] min-w-0 rounded-2xl p-3 shadow-sm sm:max-w-[70%] ${m.author.id === userId ? "bg-primary text-primary-foreground ml-auto rounded-br-md" : "bg-card text-card-foreground rounded-bl-md"}`}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{m.author.name}</span>
                  <span className="text-xs opacity-70">
                    {new Date(m.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {m.deletedAt ? (
                  <p className="text-muted-foreground text-sm italic">
                    Message deleted
                  </p>
                ) : (
                  <>
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {m.body}
                    </p>
                    {m.editedAt && (
                      <span className="text-muted-foreground text-xs">
                        Edited
                      </span>
                    )}
                    {m.attachments.map((file) => (
                      <a
                        key={file.id}
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block min-w-0"
                      >
                        <span className="text-primary block truncate text-xs underline">
                          {file.name}
                        </span>
                        {file.mimeType.startsWith("image/") && (
                          <img
                            src={file.url}
                            alt={file.name}
                            className="mt-1 max-h-80 max-w-full rounded border object-contain"
                          />
                        )}
                      </a>
                    ))}
                    {m.source && safeSnapshotHref(m.source.href) && (
                      <a
                        href={m.source.href}
                        title={m.source.title}
                        className="text-primary mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4"
                      >
                        <ExternalLinkIcon className="size-4" />
                        Open snapshot source
                      </a>
                    )}
                    {m.author.id === userId &&
                      !m.source &&
                      !m.attachments.some((file) =>
                        file.mimeType.startsWith("image/"),
                      ) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-7 px-1 text-xs"
                          aria-label={`Delete message from ${m.author.name}`}
                          onClick={() =>
                            void remove
                              .mutateAsync({
                                conversationId: id,
                                messageId: m.id,
                              })
                              .then(() => {
                                setOlder((current) =>
                                  current.map((message) =>
                                    message.id === m.id
                                      ? {
                                          ...message,
                                          body: "",
                                          attachments: [],
                                          deletedAt: new Date(),
                                        }
                                      : message,
                                  ),
                                );
                                return utils.conversations.history.invalidate({
                                  conversationId: id,
                                });
                              })
                              .catch((reason) => setError(text(reason)))
                          }
                        >
                          <Trash2Icon className="size-3" />
                          Delete
                        </Button>
                      )}
                  </>
                )}
              </article>
            ))}
          {!history.isLoading && !history.error && !messages.length && (
            <p className="bg-card text-card-foreground rounded-xl px-4 py-3 text-sm shadow-sm">
              Send a message or share a snapshot to start the conversation.
            </p>
          )}
        </div>
      </div>
      <AngleTrim edge="bottom" />
      <form
        className="max-h-full min-h-0 shrink overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        style={EXPANDED_METAL}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className={`${CHAT_COLUMN} space-y-2`}>
          {error && (
            <p
              role="alert"
              className="bg-card text-destructive rounded-md p-2 text-sm"
            >
              {error}
            </p>
          )}
          {!!files.length && (
            <div
              aria-label="Pending attachments"
              className="flex flex-wrap gap-2"
            >
              {files.map((f) => (
                <span
                  key={f.id}
                  className="bg-muted flex max-w-full items-center gap-2 rounded px-2 py-1 text-xs"
                >
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    disabled={busy || locked}
                    aria-label={`Remove ${f.name}`}
                    onClick={() => {
                      void removePendingConversationFile(f.id).catch(
                        () => undefined,
                      );
                      setFiles((current) =>
                        current.filter((file) => file.id !== f.id),
                      );
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInput}
              type="file"
              aria-label="Attach files"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => void upload(e.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ON_METAL}
              disabled={!online || busy || locked || denied}
              aria-label="Attach file"
              onClick={() => fileInput.current?.click()}
            >
              <PaperclipIcon className="size-4" />
            </Button>
            <textarea
              aria-label="Message"
              value={body}
              maxLength={8000}
              disabled={busy || locked || denied || !userId}
              placeholder="Message"
              rows={1}
              onChange={(e) => setBody(e.target.value)}
              className="bg-background min-h-12 min-w-0 flex-1 resize-none rounded-lg border px-3 py-[11px] text-base leading-6 shadow-md"
            />
            <Button
              type="submit"
              className="h-12 shrink-0 shadow-md"
              disabled={
                !online || busy || denied || (!body.trim() && !files.length)
              }
              aria-label={locked ? "Retry message" : "Send message"}
            >
              <SendIcon className="size-4" />
              <span className="hidden sm:inline">
                {busy ? "Sending…" : locked ? "Retry" : "Send"}
              </span>
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
