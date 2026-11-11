"use client";

import type { ReactNode } from "react";
import { format, isToday, isYesterday } from "date-fns";
import {
  BellIcon,
  FilePenLineIcon,
  MessageSquareIcon,
  PackageIcon,
  RefreshCwIcon,
  WifiOffIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import type {
  AppNotification,
  NotificationKind,
} from "~/lib/app-notifications";
import { cn } from "~/lib/utils";
import { PushNotifications } from "./PushNotifications";
import { JobNotificationSettings } from "./JobNotificationSettings";

type Props = {
  accountKey: string | null;
  isOnline: boolean;
  settingsOpen: boolean;
  actionError: string | null;
  identityLoading: boolean;
  listLoading: boolean;
  listError: boolean;
  overviewError: boolean;
  unreadOnly: boolean;
  working: boolean;
  items: AppNotification[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  setUnreadOnly: (value: boolean) => void;
  onRefresh: () => void;
  onVisit: (notification: AppNotification) => void;
  onLoadMore: () => void;
};

export default function NotificationPanel({
  accountKey,
  isOnline,
  settingsOpen,
  actionError,
  identityLoading,
  listLoading,
  listError,
  overviewError,
  unreadOnly,
  working,
  items,
  hasNextPage,
  isFetchingNextPage,
  setUnreadOnly,
  onRefresh,
  onVisit,
  onLoadMore,
}: Props) {
  const groups = groupByDay(items);
  return (
    <div
      className="min-h-40 flex-1 overflow-y-auto overscroll-contain"
      aria-busy={listLoading || working}
    >
      {settingsOpen ? (
        <section
          aria-label="Notification preferences"
          className="space-y-5 p-4"
        >
          <div className="bg-card rounded-xl border p-4">
            <PushNotifications />
          </div>
          {accountKey && (
            <JobNotificationSettings
              accountKey={accountKey}
              isOnline={isOnline}
            />
          )}
        </section>
      ) : (
        <>
          {actionError && (
            <p
              role="alert"
              className="border-destructive/30 bg-destructive/10 text-destructive mx-4 mt-4 rounded-lg border px-3 py-2 text-sm"
            >
              {actionError}
            </p>
          )}
          {!isOnline && (
            <p
              role="status"
              className="bg-muted text-muted-foreground mx-4 mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
            >
              <WifiOffIcon className="h-4 w-4 shrink-0" />
              You&apos;re offline. Connect to refresh notifications.
            </p>
          )}
          {identityLoading || (accountKey && listLoading) ? (
            <div
              role="status"
              aria-label="Loading notifications"
              className="space-y-3 p-4"
            >
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : !accountKey ? (
            <EmptyState
              title="Notifications unavailable"
              text="Notifications are available for signed-in members with access to Jobs."
            />
          ) : listError || overviewError ? (
            <div role="alert" className="p-8 text-center text-sm">
              <p>Could not load notifications.</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  onRefresh();
                }}
              >
                <RefreshCwIcon className="h-4 w-4" />
                Try again
              </Button>
            </div>
          ) : !items.length ? (
            <EmptyState
              title={
                unreadOnly
                  ? "No unread notifications."
                  : "No notifications yet."
              }
              text={
                unreadOnly
                  ? "You're all caught up."
                  : "Drawing, material list and chat activity will show up here."
              }
              action={
                unreadOnly ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUnreadOnly(false)}
                  >
                    Show all notifications
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="space-y-4 p-4">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h3 className="text-muted-foreground mb-2 px-1 text-xs font-semibold tracking-wide uppercase">
                    {group.label}
                  </h3>
                  <ul className="bg-card divide-y overflow-hidden rounded-xl border">
                    {group.items.map((notification) => (
                      <li key={notification.id}>
                        <NotificationRow
                          notification={notification}
                          disabled={working || !isOnline}
                          onSelect={() => onVisit(notification)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {hasNextPage && (
            <div className="px-4 pb-4 text-center">
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={isFetchingNextPage || !isOnline}
                onClick={() => {
                  onLoadMore();
                }}
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const KIND_STYLE: Record<
  NotificationKind,
  { icon: typeof BellIcon; className: string }
> = {
  drawing: {
    icon: FilePenLineIcon,
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  "material-list": {
    icon: PackageIcon,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  "job-chat": {
    icon: MessageSquareIcon,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  conversation: {
    icon: MessageSquareIcon,
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
};

function NotificationRow({
  notification,
  disabled,
  onSelect,
}: {
  notification: AppNotification;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { icon: Icon, className } = KIND_STYLE[notification.kind];
  const created = new Date(notification.createdAt);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "hover:bg-accent focus-visible:ring-ring relative flex w-full gap-3 px-4 py-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset disabled:opacity-60",
        notification.unread && "bg-primary/[0.04]",
      )}
    >
      {notification.unread && (
        <span
          aria-hidden="true"
          className="bg-primary absolute inset-y-0 left-0 w-1"
        />
      )}
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          className,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              notification.unread ? "font-semibold" : "font-medium",
            )}
          >
            {notification.title}
          </span>
          <time
            className={cn(
              "shrink-0 text-xs",
              notification.unread
                ? "text-primary font-medium"
                : "text-muted-foreground",
            )}
            dateTime={notification.createdAt}
            title={created.toLocaleString()}
          >
            {shortAge(created)}
          </time>
        </span>
        {notification.context && (
          <span className="text-muted-foreground mt-0.5 block truncate text-xs">
            {notification.context}
          </span>
        )}
        <span
          className={cn(
            "mt-1 line-clamp-2 block text-sm [overflow-wrap:anywhere] break-words",
            !notification.unread && "text-muted-foreground",
          )}
        >
          {notification.description}
        </span>
        {notification.unread && <span className="sr-only">Unread</span>}
      </span>
    </button>
  );
}

function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-14 text-center">
      <span className="bg-background flex h-16 w-16 items-center justify-center rounded-full border shadow-sm">
        <BellIcon className="text-muted-foreground h-7 w-7" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-muted-foreground text-sm">{text}</p>
      </div>
      {action}
    </div>
  );
}

function shortAge(date: Date) {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / (60 * 24))}d`;
  return format(date, "MMM d");
}

function groupByDay(items: AppNotification[]) {
  const groups: { label: string; items: AppNotification[] }[] = [];
  for (const item of items) {
    const date = new Date(item.createdAt);
    const label = isToday(date)
      ? "Today"
      : isYesterday(date)
        ? "Yesterday"
        : "Earlier";
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
