"use client";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  BoxIcon,
  DoorOpenIcon,
  FilesIcon,
  FolderOpenIcon,
  MessageCircleIcon,
  PackageIcon,
  NetworkIcon,
  WrenchIcon,
} from "lucide-react";
import { type JobWorkspaceOptionId } from "~/lib/job-workspace-last-option";
import { useDrawingsAccess } from "~/components/permissions/DrawingsAccess";

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
  const canAccessDrawings = useDrawingsAccess();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        data-tutorial="material-lists"
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect("material-lists");
          }
        }}
        className="cursor-pointer transition-shadow hover:shadow-md"
        onClick={() => onSelect("material-lists")}
      >
        <CardHeader>
          <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
            Material Lists
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <PackageIcon className="h-4 w-4" />
              <span>
                {materialListCount} {materialListCount === 1 ? "list" : "lists"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      {canAccessDrawings && (
        <Card
          data-tutorial="drawings"
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect("drawings");
            }
          }}
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => onSelect("drawings")}
        >
          <CardHeader>
            <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
              Drawings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <FolderOpenIcon className="h-4 w-4" />
              <span>Drawing sets to view on site</span>
            </div>
          </CardContent>
        </Card>
      )}
      <Card
        role="button"
        data-tutorial="chat"
        tabIndex={0}
        aria-label={
          chatUnreadCount > 0
            ? `Chat, ${chatUnreadCount} unread messages`
            : "Chat"
        }
        className="focus-visible:ring-ring cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2"
        onClick={() => onSelect("chat")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect("chat");
          }
        }}
      >
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Chat
            {chatUnreadCount > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
                {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <MessageCircleIcon className="h-4 w-4" />
            <span>Messages, photos &amp; files for this job</span>
          </div>
        </CardContent>
      </Card>
      <Card
        data-tutorial="documents"
        role="button"
        aria-label="Documents"
        tabIndex={0}
        className="focus-visible:ring-ring cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2"
        onClick={() => onSelect("documents")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect("documents");
          }
        }}
      >
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <FilesIcon className="h-4 w-4" />
            <span>Files, revisions, reviews &amp; Office documents</span>
          </div>
        </CardContent>
      </Card>
      <Card
        role="button"
        aria-label="Systems"
        tabIndex={0}
        className="focus-visible:ring-ring cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2"
        onClick={() => onSelect("systems")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect("systems");
          }
        }}
      >
        <CardHeader>
          <CardTitle className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 leading-tight break-words">
            <span>Systems</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              Experimental
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <NetworkIcon className="h-4 w-4" />
            <span>Job specifications, material rules &amp; catalogue choices</span>
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
            <div className="text-muted-foreground space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <WrenchIcon className="h-4 w-4" />
                <span>Checked out, requests &amp; returns</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <Card
        data-tutorial="rooms"
        aria-label="Rooms, experimental"
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect("rooms");
          }
        }}
        className="cursor-pointer transition-shadow hover:shadow-md"
        onClick={() => onSelect("rooms")}
      >
        <CardHeader>
          <CardTitle className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 leading-tight break-words">
            <span>Rooms</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              Experimental
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <DoorOpenIcon className="h-4 w-4" />
              <span>
                {roomCount === undefined
                  ? roomCountLoading
                    ? "Loading rooms…"
                    : "Room count unavailable"
                  : `${roomCount} ${roomCount === 1 ? "room" : "rooms"}`}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
      {canAccessDrawings && (
        <Card
          role="button"
          tabIndex={0}
          aria-label="Models, experimental"
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={() => onSelect("models")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect("models");
            }
          }}
        >
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span>Models</span>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Experimental
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <BoxIcon className="h-4 w-4" />
              <span>Revit &amp; IFC · 3D construction coordination</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
