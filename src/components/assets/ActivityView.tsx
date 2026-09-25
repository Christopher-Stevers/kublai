"use client";

import Link from "next/link";
import { HistoryIcon } from "lucide-react";

import { ListPageSkeleton } from "~/components/ui/skeleton";
import { api } from "~/trpc/react";

import { AssetsShell, EmptyState, ErrorText, describeMovement, formatWhen, useIsOnline } from "./shared";

export function ActivityView() {
  const isOnline = useIsOnline();
  const activity = api.assets.activity.useQuery({ limit: 200 }, { enabled: isOnline });

  return (
    <AssetsShell title="Activity" description="Every check-out, return, move, status change and count">
      {activity.isLoading ? (
        <ListPageSkeleton label="Loading activity" />
      ) : activity.error ? (
        <ErrorText message={activity.error.message} />
      ) : !activity.data?.length ? (
        <EmptyState icon={<HistoryIcon />} title="No activity yet" />
      ) : (
        <ol className="bg-card divide-y rounded-lg border">
          {activity.data.map((m) => (
            <li key={m.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{m.toolName}</span>
                {m.assetTag && <span className="text-muted-foreground font-mono text-xs">{m.assetTag}</span>}
              </div>
              <div>{describeMovement(m)}</div>
              <div className="text-muted-foreground text-xs">
                {formatWhen(m.createdAt)}
                {m.by ? ` · ${m.by}` : ""}
              </div>
              {m.note && <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">{m.note}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className="text-muted-foreground text-xs">
        Showing the latest 200. Each tool&apos;s full history is on its{" "}
        <Link href="/dashboard/assets/tools" className="hover:underline">
          page
        </Link>
        .
      </p>
    </AssetsShell>
  );
}
