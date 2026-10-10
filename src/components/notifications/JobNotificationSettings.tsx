"use client";

import { useState } from "react";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";

export function JobNotificationSettings({
  accountKey,
  isOnline,
}: {
  accountKey: string;
  isOnline: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const settings = api.notifications.jobSettings.useQuery(
    { accountKey },
    { enabled: open && isOnline, staleTime: 0, retry: false },
  );
  const update = api.notifications.setJobSettings.useMutation();

  const toggle = async (jobId: string, muted: boolean) => {
    if (!isOnline || update.isPending) return;
    setError(null);
    try {
      await update.mutateAsync({ accountKey, jobId, muted });
      await Promise.all([
        utils.notifications.jobSettings.invalidate({ accountKey }),
        utils.notifications.overview.invalidate({ accountKey }),
        utils.notifications.list.invalidate({ accountKey }),
        utils.chat.getOverview.invalidate({ jobId }),
      ]);
    } catch {
      setError("Could not change job notifications. Reconnect and try again.");
    }
  };

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between px-0 hover:bg-transparent"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Job chat notifications
        <ChevronDownIcon className={open ? "size-4 rotate-180" : "size-4"} />
      </Button>
      {open && (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-muted-foreground text-xs">
            Choose which job chats appear in your notifications and send push
            alerts.
          </p>
          {!isOnline ? (
            <p role="status">Connect to change job notifications.</p>
          ) : settings.isError ? (
            <p role="alert">
              Could not load job notifications.{" "}
              <button
                className="underline"
                onClick={() => void settings.refetch()}
              >
                Retry
              </button>
            </p>
          ) : settings.isLoading ? (
            <p role="status" className="flex items-center gap-2">
              <Loader2Icon className="size-4 animate-spin" /> Loading job chats…
            </p>
          ) : settings.data?.accountKey === accountKey &&
            settings.data.jobs.length ? (
            <ul className="max-h-48 overflow-y-auto overscroll-contain">
              {settings.data.jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex min-h-12 items-center justify-between gap-3 border-t py-2"
                >
                  <span className="min-w-0 break-words">{job.name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-label={`${job.name} notifications`}
                    aria-checked={!job.muted}
                    disabled={!isOnline || update.isPending}
                    onClick={() => void toggle(job.id, !job.muted)}
                    className={`inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-lg border px-3 text-xs font-medium disabled:opacity-50 ${job.muted ? "text-muted-foreground" : "border-primary text-primary bg-primary/10"}`}
                  >
                    {job.muted ? "Off" : "On"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              Your job chats will appear here.
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
