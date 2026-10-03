"use client";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DoorOpenIcon, MessageCircleIcon, PackageIcon, WrenchIcon } from "lucide-react";
import { type JobWorkspaceOptionId } from "~/lib/job-workspace-last-option";

export type { JobWorkspaceOptionId };

export function JobWorkspaceOptions({
  materialListCount = 0,
  roomCount,
  roomCountLoading = false,
  chatUnreadCount = 0,
  onSelect,
  onTools,
}: {
  materialListCount?: number;
  roomCount?: number;
  roomCountLoading?: boolean;
  chatUnreadCount?: number;
  onSelect: (id: JobWorkspaceOptionId) => void;
  /** Opens the job's tools in Asset Management (when that tab is available). */
  onTools?: () => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        className="cursor-pointer transition-shadow hover:shadow-md"
        onClick={() => onSelect("material-lists")}
      >
        <CardHeader>
          <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
            Material Lists
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <PackageIcon className="h-4 w-4" />
              <span>
                {materialListCount} {materialListCount === 1 ? "list" : "lists"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card
        className="cursor-pointer transition-shadow hover:shadow-md"
        onClick={() => onSelect("rooms")}
      >
        <CardHeader>
          <CardTitle className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 leading-tight break-words">
            <span>Rooms</span>
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">
              Experimental
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <DoorOpenIcon className="h-4 w-4" />
              <span>
                {roomCount === undefined
                  ? roomCountLoading ? "Loading rooms…" : "Room count unavailable"
                  : `${roomCount} ${roomCount === 1 ? "room" : "rooms"}`}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card
        role="button"
        tabIndex={0}
        aria-label={chatUnreadCount > 0 ? `Chat, ${chatUnreadCount} unread messages` : "Chat"}
        className="cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect("chat")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect("chat"); }
        }}
      >
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Chat
            {chatUnreadCount > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{chatUnreadCount > 99 ? "99+" : chatUnreadCount}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MessageCircleIcon className="h-4 w-4" />
            <span>Messages, photos &amp; files for this job</span>
          </div>
        </CardContent>
      </Card>
      {onTools && (
        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={onTools}
        >
          <CardHeader>
            <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
              Tools
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <WrenchIcon className="h-4 w-4" />
                <span>Checked out, requests &amp; returns</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
