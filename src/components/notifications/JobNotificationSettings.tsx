"use client";

import { useState } from "react";
import { Loader2Icon, MessageSquareIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { SwitchTrack } from "~/components/ui/switch";

export function JobNotificationSettings({
  accountKey,
  isOnline,
}: {
  accountKey: string;
  isOnline: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const settings = api.notifications.jobSettings.useQuery(
    { accountKey },
    { enabled: isOnline, staleTime: 0, retry: false },
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

  const jobs =
    settings.data?.accountKey === accountKey ? settings.data.jobs : [];
  return (
    <section aria-labelledby="job-chat-settings" className="space-y-2">
      <div className="px-1">
        <h3 id="job-chat-settings" className="text-sm font-semibold">
          Job chats
        </h3>
        <p className="text-muted-foreground text-xs">
          Turn a chat off to stop its notifications and push alerts.
        </p>
      </div>
      <div className="bg-card overflow-hidden rounded-xl border text-sm">
        {!isOnline ? (
          <p role="status" className="text-muted-foreground p-4">
            Connect to change job notifications.
          </p>
        ) : settings.isError ? (
          <p role="alert" className="p-4">
            Could not load job notifications.{" "}
            <button
              className="underline"
              onClick={() => void settings.refetch()}
            >
              Retry
            </button>
          </p>
        ) : settings.isLoading ? (
          <p
            role="status"
            className="text-muted-foreground flex items-center gap-2 p-4"
          >
            <Loader2Icon className="size-4 animate-spin" /> Loading job chats…
          </p>
        ) : jobs.length ? (
          <ul className="divide-y">
            {jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  role="switch"
                  aria-label={`${job.name} notifications`}
                  aria-checked={!job.muted}
                  disabled={!isOnline || update.isPending}
                  onClick={() => void toggle(job.id, !job.muted)}
                  className="hover:bg-accent focus-visible:ring-ring flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset disabled:opacity-60"
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full ${job.muted ? "bg-muted text-muted-foreground" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}
                  >
                    <MessageSquareIcon className="size-4" />
                  </span>
                  <span
                    className={`min-w-0 flex-1 break-words ${job.muted ? "text-muted-foreground" : "font-medium"}`}
                  >
                    {job.name}
                  </span>
                  <SwitchTrack checked={!job.muted} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground p-4">
            Your job chats will appear here.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive px-1 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
