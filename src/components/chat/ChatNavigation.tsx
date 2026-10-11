"use client";
import { useRef } from "react";
import { useChatScroll } from "~/hooks/use-chat-scroll";
import { HardHatIcon, MessageSquareIcon, UsersIcon } from "lucide-react";
import { Input } from "~/components/ui/input";

export type ChatDestination = { kind: "conversation" | "job"; id: string };
type Conversation = {
  id: string;
  name: string;
  kind: string;
  unreadCount: number;
  members: { name: string }[];
};
export function ChatNavigation({
  conversations,
  jobs,
  selected,
  onSelect,
  loading,
  search,
  onSearch,
  memoryKey,
}: {
  conversations: Conversation[];
  jobs: { id: string; name: string }[];
  selected: ChatDestination | null;
  onSelect: (chat: ChatDestination) => void;
  loading: boolean;
  search: string;
  onSearch: (value: string) => void;
  memoryKey: string;
}) {
  const list = useRef<HTMLElement>(null);
  const rememberScroll = useChatScroll(memoryKey, list, !loading);
  const query = search.trim().toLocaleLowerCase();
  const groups = [
    {
      name: "Direct chats",
      kind: "conversation" as const,
      icon: MessageSquareIcon,
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
      icon: UsersIcon,
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
      icon: HardHatIcon,
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-3">
        <Input
          type="search"
          aria-label="Search chats"
          placeholder="Search chats…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      <nav
        ref={list}
        onScroll={rememberScroll}
        aria-label="Chats"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
      >
        {loading && (
          <p role="status" className="text-muted-foreground px-4 py-3 text-sm">
            Loading chats…
          </p>
        )}
        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <div key={group.name} className="mb-3">
                <h2 className="text-muted-foreground px-4 pt-2 pb-1 text-xs font-semibold">
                  {group.name}
                </h2>
                {group.items.map((item) => {
                  const active =
                    selected?.kind === group.kind && selected.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() =>
                        onSelect({ kind: group.kind, id: item.id })
                      }
                      className={`hover:bg-accent flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left ${active ? "bg-accent border-primary border-l-2 pl-[14px]" : ""}`}
                    >
                      <group.icon
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {item.name}
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          {item.description}
                        </span>
                      </span>
                      {item.unreadCount > 0 && (
                        <span
                          aria-label={`${item.unreadCount} unread messages`}
                          className="bg-primary text-primary-foreground shrink-0 rounded-full px-2 py-0.5 text-xs"
                        >
                          {item.unreadCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ),
        )}
        {!loading && groups.every((group) => !group.items.length) && (
          <p className="text-muted-foreground px-4 py-3 text-sm">
            {query
              ? "No chats match your search."
              : "Start a new chat with someone in your organization."}
          </p>
        )}
      </nav>
    </div>
  );
}
