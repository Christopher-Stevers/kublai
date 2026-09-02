"use client";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { DoorOpenIcon, PackageIcon } from "lucide-react";
import { type JobWorkspaceOptionId } from "~/lib/job-workspace-last-option";

export type { JobWorkspaceOptionId };

export function JobWorkspaceOptions({
  materialListCount = 0,
  roomCount = 0,
  onSelect,
}: {
  materialListCount?: number;
  roomCount?: number;
  onSelect: (id: JobWorkspaceOptionId) => void;
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
          <div className="space-y-2 text-sm text-gray-600">
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
          <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
            Rooms
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <DoorOpenIcon className="h-4 w-4" />
              <span>
                {roomCount} {roomCount === 1 ? "room" : "rooms"}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
