"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
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
  uploadConversationFile,
  removePendingConversationFile,
} from "~/lib/conversation-upload";
import type { ConversationMessage } from "~/server/conversations/contracts";
import { useOnlineStatus } from "~/hooks/use-online-status";
const text = (reason: unknown) =>
  reason instanceof Error
    ? reason.message
    : "Could not complete this action. Try again.";
export function ConversationsView() {
  const router = useRouter(),
    params = useSearchParams(),
    online = useOnlineStatus(),
    utils = api.useUtils();
  const [newOpen, setNewOpen] = useState(false),
    [target, setTarget] = useState<ChatTarget>({
      mode: "direct",
      recipientIds: [],
      name: "",
    }),
    [error, setError] = useState("");
  const selected = params.get("conversation");
  const list = api.conversations.list.useQuery(undefined, {
    enabled: online,
    refetchInterval: online ? 5000 : false,
  });
  const create = api.conversations.create.useMutation();
  const current = list.data?.conversations.find((c) => c.id === selected);
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
      router.push(`/dashboard/chat?conversation=${encodeURIComponent(id)}`);
    } catch (reason) {
      setError(text(reason));
    }
  };
  return (
    <section
      aria-label="People and group chat"
      className="mx-auto flex h-[calc(100dvh-3.5rem)] max-w-7xl flex-col overflow-hidden sm:h-[calc(100dvh-4rem)]"
    >
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <MessageSquareIcon className="size-5" />
          Chat
        </h1>
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
      </header>
      {!online && (
        <p role="status" className="bg-muted px-4 py-2 text-sm">
          Connect to the internet to use person and group chats.
        </p>
      )}
      {list.error && (
        <p role="alert" className="text-destructive px-4 py-2">
          Could not load conversations.{" "}
          <button className="underline" onClick={() => void list.refetch()}>
            Retry
          </button>
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Conversations"
          className={`${selected ? "hidden md:block" : "block"} w-full shrink-0 overflow-y-auto border-r md:w-72`}
        >
          {list.isLoading && (
            <p role="status" className="p-4 text-sm">
              Loading conversations…
            </p>
          )}
          {list.data?.conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-current={selected === c.id ? "page" : undefined}
              onClick={() =>
                router.push(
                  `/dashboard/chat?conversation=${encodeURIComponent(c.id)}`,
                )
              }
              className={`hover:bg-accent flex w-full items-center justify-between gap-2 border-b px-4 py-3 text-left ${selected === c.id ? "bg-accent" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="text-muted-foreground block text-xs">
                  {c.kind === "group"
                    ? `${c.members.length} people`
                    : "Direct conversation"}
                </span>
              </span>
              {c.unreadCount > 0 && (
                <span
                  aria-label={`${c.unreadCount} unread messages`}
                  className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs"
                >
                  {c.unreadCount}
                </span>
              )}
            </button>
          ))}
          {!list.isLoading &&
            !list.error &&
            list.data?.conversations.length === 0 && (
              <p className="text-muted-foreground p-4 text-sm">
                Start a conversation with a person or a group in your
                organization.
              </p>
            )}
          <a
            className="text-primary block border-t p-4 text-sm underline"
            href="/dashboard"
          >
            Open job chat from a job
          </a>
        </aside>
        {selected ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-2 border-b px-3 py-2">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Back to conversations"
                className="shrink-0 md:hidden"
                onClick={() => router.push("/dashboard/chat")}
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
              <div className="min-w-0">
                <h2 className="truncate font-semibold">
                  {current?.name ?? "Conversation"}
                </h2>
                <p className="text-muted-foreground truncate text-xs">
                  {current?.members.map((m) => m.name).join(", ")}
                </p>
              </div>
            </header>
            <ConversationThread
              key={selected}
              id={selected}
              userId={list.data?.userId}
              online={online}
            />
          </div>
        ) : (
          <div className="text-muted-foreground hidden flex-1 items-center justify-center p-8 md:flex">
            <p>Select a conversation or start a new chat.</p>
          </div>
        )}
      </div>
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
}: {
  id: string;
  userId?: string;
  online: boolean;
}) {
  const utils = api.useUtils(),
    [body, setBody] = useState(""),
    [files, setFiles] = useState<ConversationMessage["attachments"]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
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
    } | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    timeline = useRef<HTMLDivElement>(null),
    lastRead = useRef(0),
    tail = useRef(""),
    bottom = useRef(true);
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
        className="bg-muted/30 min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
        onScroll={() => {
          if (timeline.current)
            bottom.current =
              timeline.current.scrollHeight -
                timeline.current.scrollTop -
                timeline.current.clientHeight <
              80;
        }}
      >
        {history.isLoading && <p role="status">Loading messages…</p>}
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
              className={`max-w-xl rounded-lg border p-3 ${m.author.id === userId ? "bg-primary/10 ml-auto" : "bg-card"}`}
            >
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{m.author.name}</span>
                <span className="text-muted-foreground text-xs">
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
                  {m.author.id === userId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-7 px-1 text-xs"
                      aria-label={`Delete message from ${m.author.name}`}
                      onClick={() =>
                        void remove
                          .mutateAsync({ conversationId: id, messageId: m.id })
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
          <p className="text-muted-foreground text-sm">
            Send a message or share a snapshot to start the conversation.
          </p>
        )}
      </div>
      <form
        className="shrink-0 space-y-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && (
          <p role="alert" className="text-destructive text-sm">
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
            variant="outline"
            size="icon"
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
            disabled={busy || locked || denied}
            placeholder="Message"
            rows={2}
            onChange={(e) => setBody(e.target.value)}
            className="bg-background min-w-0 flex-1 resize-none rounded-md border p-2 text-sm"
          />
          <Button
            type="submit"
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
      </form>
    </>
  );
}
