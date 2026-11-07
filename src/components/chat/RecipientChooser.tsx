"use client";
import { useState } from "react";
import { api } from "~/trpc/react";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
export type ChatTarget =
  | { mode: "existing"; conversationId: string }
  | { mode: "direct" | "group"; recipientIds: string[]; name: string };
export function RecipientChooser({
  value,
  onChange,
  disabled = false,
}: {
  value: ChatTarget;
  onChange: (value: ChatTarget) => void;
  disabled?: boolean;
}) {
  const people = api.conversations.people.useQuery();
  const chats = api.conversations.list.useQuery();
  const [search, setSearch] = useState("");
  const candidates =
    people.data?.filter((p) =>
      `${p.name} ${p.email}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">Send to</legend>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Conversation type"
      >
        {(["people", "existing"] as const).map((destination) => {
          const selected =
            destination === "existing"
              ? value.mode === "existing"
              : value.mode !== "existing";
          return (
            <Button
              key={destination}
              size="sm"
              type="button"
              variant={selected ? "default" : "outline"}
              aria-pressed={selected}
              onClick={() => {
                if (destination === "existing")
                  onChange({ mode: "existing", conversationId: "" });
                else if (value.mode === "existing")
                  onChange({ mode: "direct", recipientIds: [], name: "" });
              }}
            >
              {destination === "people" ? "People" : "Existing chat"}
            </Button>
          );
        })}
      </div>
      {value.mode === "existing" ? (
        <label className="block space-y-1 text-sm">
          Conversation
          <select
            aria-label="Conversation"
            value={value.conversationId}
            onChange={(e) =>
              onChange({ mode: "existing", conversationId: e.target.value })
            }
            className="bg-background w-full rounded-md border p-2"
          >
            <option value="">Choose a conversation</option>
            {chats.data?.conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.kind === "group" ? ` (${c.members.length} people)` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          {value.mode === "group" && (
            <label className="block space-y-1 text-sm">
              Group name
              <Input
                aria-label="Group name"
                maxLength={120}
                value={value.name}
                onChange={(e) => onChange({ ...value, name: e.target.value })}
                placeholder="e.g. Site coordination"
              />
            </label>
          )}
          <Input
            aria-label="Search people"
            placeholder="Search people"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div
            role="group"
            aria-label="Recipients"
            className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-1"
          >
            {candidates.map((person) => (
              <label
                key={person.id}
                className="hover:bg-accent flex cursor-pointer items-center gap-3 rounded p-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="chat-recipient"
                  aria-label={person.name}
                  checked={value.recipientIds.includes(person.id)}
                  onChange={(e) => {
                    const recipientIds = e.target.checked
                      ? [...value.recipientIds, person.id]
                      : value.recipientIds.filter((id) => id !== person.id);
                    const mode = recipientIds.length > 1 ? "group" : "direct";
                    const name =
                      mode === "group" && !value.name.trim()
                        ? recipientIds
                            .map(
                              (id) =>
                                people.data?.find((p) => p.id === id)?.name ??
                                "Member",
                            )
                            .join(", ")
                            .slice(0, 120)
                        : value.name;
                    onChange({ mode, recipientIds, name });
                  }}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {person.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {person.email}
                  </span>
                </span>
              </label>
            ))}
            {!people.isLoading && !candidates.length && (
              <p className="text-muted-foreground p-2 text-sm">
                No matching people in your organization.
              </p>
            )}
            {people.isLoading && (
              <p role="status" className="p-2 text-sm">
                Loading people…
              </p>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {value.recipientIds.length} selected
            {value.mode === "group"
              ? " · Group chat. You are included."
              : value.recipientIds.length === 1
                ? " · Direct chat"
                : " · Select one person for a direct chat, or several for a group."}
          </p>
        </>
      )}
      {(people.error ?? chats.error) && (
        <p role="alert" className="text-destructive text-sm">
          Could not load recipients. Check your connection and try again.
        </p>
      )}
    </fieldset>
  );
}
export function validChatTarget(target: ChatTarget) {
  return target.mode === "existing"
    ? Boolean(target.conversationId)
    : target.recipientIds.length > 0 &&
        target.recipientIds.length <= 49 &&
        (target.mode !== "direct" || target.recipientIds.length === 1) &&
        (target.mode !== "group" || Boolean(target.name.trim()));
}
