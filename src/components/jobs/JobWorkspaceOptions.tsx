"use client";
import { PressableCard } from "~/components/ui/pressable-card";
import { prepareWorkspaceOption } from "~/routes/registry";
import { useDevFeatures } from "~/components/app/DevFeaturesProvider";
import { VoiceCard } from "~/components/voice/VoiceProvider";

import { useSystemsAccess } from "~/components/permissions/SystemsAccess";
import { FrequentJobCards } from "./FrequentJobCards";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  BoxIcon,
  DoorOpenIcon,
  FilesIcon,
  FolderOpenIcon,
  MessageCircleIcon,
  PackageIcon,
  NetworkIcon,
} from "lucide-react";
import { type JobWorkspaceOptionId } from "~/lib/job-workspace-last-option";
import { useDrawingsAccess } from "~/components/permissions/DrawingsAccess";
import { DevBadge } from "~/components/app/DevBadge";

export type { JobWorkspaceOptionId };

export function JobWorkspaceOptions({
  jobId,
  materialListCount = 0,
  roomCount,
  roomCountLoading = false,
  chatUnreadCount = 0,
  onSelect,
}: {
  jobId?: string;
  materialListCount?: number;
  roomCount?: number;
  roomCountLoading?: boolean;
  chatUnreadCount?: number;
  onSelect: (id: JobWorkspaceOptionId) => void;
}) {
  const canAccessSystems = useSystemsAccess();
  const canAccessDrawings = useDrawingsAccess();
  const devFeatures = useDevFeatures();
  return (
    <>
    <FrequentJobCards trailingCards={devFeatures ? <VoiceCard /> : null}>
      <PressableCard
        data-job-card="material-lists"
        prepare={signal => { if (jobId) void prepareWorkspaceOption("material-lists", jobId, signal); }}
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
      </PressableCard>
      {canAccessDrawings && (
        <PressableCard
          data-job-card="drawings"
        prepare={signal => { if (jobId) void prepareWorkspaceOption("drawings", jobId, signal); }}
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
        </PressableCard>
      )}
      <PressableCard
        data-job-card="chat"
        prepare={signal => { if (jobId) void prepareWorkspaceOption("chat", jobId, signal); }}
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
      </PressableCard>
      <PressableCard
        data-job-card="documents"
        prepare={signal => { if (jobId) void prepareWorkspaceOption("documents", jobId, signal); }}
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
      </PressableCard>
      <PressableCard
        data-job-card="rooms"
        prepare={signal => { if (jobId) void prepareWorkspaceOption("rooms", jobId, signal); }}
        data-tutorial="rooms"
        aria-label="Rooms"
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
      </PressableCard>
      {devFeatures && canAccessDrawings && (
        <PressableCard
          data-job-card="models"
        prepare={signal => { if (jobId) void prepareWorkspaceOption("models", jobId, signal); }}
          role="button"
          tabIndex={0}
          aria-label="Models, Dev"
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
              <DevBadge />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <BoxIcon className="h-4 w-4" />
              <span>Revit &amp; IFC · 3D construction coordination</span>
            </div>
          </CardContent>
        </PressableCard>
      )}
      {devFeatures && canAccessSystems && <PressableCard
        data-job-card="systems"
        prepare={signal => { if (jobId) void prepareWorkspaceOption("systems", jobId, signal); }}
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
            <DevBadge />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <NetworkIcon className="h-4 w-4" />
            <span>
              Job specifications, material rules &amp; catalogue choices
            </span>
          </div>
        </CardContent>
      </PressableCard>}
    </FrequentJobCards>
    </>
  );
}
