"use client";
import { useRef, useState, type CSSProperties } from "react";
import { ChevronDownIcon, HardHatIcon, UsersIcon } from "lucide-react";
import { useChatScroll } from "~/hooks/use-chat-scroll";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export type ChatDestination = { kind: "conversation" | "job"; id: string };
type Conversation = {
  id: string;
  name: string;
  kind: string;
  unreadCount: number;
  members: { name: string }[];
};
const AVATAR_COLOURS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-fuchsia-500",
  "bg-indigo-500",
];
function colourFor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    (words.length > 1 ? `${words[0]![0]}${words.at(-1)![0]}` : name.slice(0, 2))
      .toUpperCase()
      .trim() || "?"
  );
}

export function ChatNavigation({
  conversations,
  jobs,
  selected,
  onSelect,
  loading,
  search,
  onSearch,
  memoryKey,
  animate = false,
}: {
  conversations: Conversation[];
  jobs: { id: string; name: string }[];
  selected: ChatDestination | null;
  onSelect: (chat: ChatDestination) => void;
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  memoryKey: string;
  /** Stagger the rows in, for the slide-out panel. */
  animate?: boolean;
}) {
  const list = useRef<HTMLElement>(null);
  const rememberScroll = useChatScroll(memoryKey, list, !loading);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const query = search.trim().toLocaleLowerCase();
  const groups = [
    {
      name: "Direct chats",
      kind: "conversation" as const,
      avatar: "person" as const,
      items: conversations
        .filter((c) => c.kind === "direct")
        .map((c) => ({
          ...c,
          description: "Direct chat",
          search: `${c.name} ${c.members.map((m) => m.name).join(" ")}`,
        })),
    },
    {
      name: "Groups",
      kind: "conversation" as const,
      avatar: "group" as const,
      items: conversations
        .filter((c) => c.kind === "group")
        .map((c) => ({
          ...c,
          description: `${c.members.length} people`,
          search: `${c.name} ${c.members.map((m) => m.name).join(" ")}`,
        })),
    },
    {
      name: "Job chats",
      kind: "job" as const,
      avatar: "job" as const,
      items: jobs.map((job) => ({
        ...job,
        description: "Job team",
        unreadCount: 0,
        search: job.name,
      })),
    },
  ].map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.search.toLocaleLowerCase().includes(query),
    ),
  }));
  let row = 0;
  const stagger = (): CSSProperties | undefined =>
    animate ? { animationDelay: `${Math.min(row++, 14) * 28}ms` } : undefined;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-3">
        <Input
          type="search"
          aria-label="Search chats"
          placeholder="Search chats…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          className="bg-muted/60 rounded-xl border-transparent"
        />
      </div>
      <nav
        ref={list}
        onScroll={rememberScroll}
        aria-label="Chats"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3"
      >
        {loading && (
          <p role="status" className="text-muted-foreground px-3 py-3 text-sm">
            Loading chats…
          </p>
        )}
        {groups.map((group) => {
          if (!group.items.length) return null;
          const closed = Boolean(collapsed[group.name]) && !query;
          const unread = group.items.reduce((n, i) => n + i.unreadCount, 0);
          return (
            <div key={group.name} className="mb-2">
              <h2>
                <button
                  type="button"
                  aria-expanded={!closed}
                  onClick={() =>
                    setCollapsed((state) => ({
                      ...state,
                      [group.name]: !state[group.name],
                    }))
                  }
                  className={cn(
                    "text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-2 pt-3 pb-1 text-[11px] font-bold tracking-wider uppercase transition-colors",
                    animate && "chat-drawer-item",
                  )}
                  style={stagger()}
                >
                  <ChevronDownIcon
                    aria-hidden
                    className={cn(
                      "size-3 transition-transform duration-200",
                      closed && "-rotate-90",
                    )}
                  />
                  {group.name}
                  <span className="ml-auto font-medium tabular-nums">
                    {closed && unread > 0
                      ? `${unread} new`
                      : group.items.length}
                  </span>
                </button>
              </h2>
              {!closed &&
                group.items.map((item) => {
                  const active =
                    selected?.kind === group.kind && selected.id === item.id;
                  const hasUnread = item.unreadCount > 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() =>
                        onSelect({ kind: group.kind, id: item.id })
                      }
                      style={stagger()}
                      className={cn(
                        "group relative flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-[background-color,transform] duration-150 active:scale-[0.97]",
                        active
                          ? "bg-primary/12 text-foreground"
                          : "hover:bg-accent",
                        animate && "chat-drawer-item",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "bg-foreground absolute top-1/2 -left-2 w-1 -translate-y-1/2 rounded-r-full transition-all duration-300",
                          active
                            ? "h-8"
                            : hasUnread
                              ? "h-2"
                              : "h-0 group-hover:h-4",
                        )}
                      />
                      <span
                        aria-hidden
                        className={cn(
                          "relative flex size-10 shrink-0 items-center justify-center text-sm font-bold text-white shadow-sm transition-[border-radius] duration-300",
                          group.avatar === "job"
                            ? "bg-amber-500"
                            : colourFor(item.name),
                          active
                            ? "rounded-xl"
                            : "rounded-[50%] group-hover:rounded-xl",
                        )}
                      >
                        {group.avatar === "job" ? (
                          <HardHatIcon className="size-5" />
                        ) : group.avatar === "group" ? (
                          <UsersIcon className="size-5" />
                        ) : (
                          initials(item.name)
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-sm",
                            hasUnread || active
                              ? "font-semibold"
                              : "font-medium",
                          )}
                        >
                          {item.name}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {item.description}
                        </span>
                      </span>
                      {hasUnread && (
                        <span
                          aria-label={`${item.unreadCount} unread messages`}
                          className="bg-destructive text-destructive-foreground min-w-5 shrink-0 rounded-full px-1.5 py-0.5 text-center text-xs font-bold tabular-nums"
                        >
                          {item.unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          );
        })}
        {!loading && groups.every((group) => !group.items.length) && (
          <p className="text-muted-foreground px-3 py-3 text-sm">
            {query
              ? "No chats match your search."
              : "Start a new chat with someone in your organization."}
          </p>
        )}
      </nav>
    </div>
  );
}
