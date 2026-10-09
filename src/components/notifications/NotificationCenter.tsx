"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  BellIcon,
  BellRingIcon,
  CheckCheckIcon,
  FilePenLineIcon,
  Loader2Icon,
  MessageSquareIcon,
  RefreshCwIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  notificationBadge,
  NOTIFICATION_POLL_MS,
  type AppNotification,
  type NotificationReadTarget,
} from "~/lib/app-notifications";
import { cn } from "~/lib/utils";
import { useNotificationReminder } from "./use-notification-reminder";

export function NotificationCenter({
  sessionKey = "local",
}: {
  sessionKey?: string;
}) {
  const isOnline = useOnlineStatus();
  const identity = api.notifications.identity.useQuery(
    { sessionKey },
    {
      enabled: isOnline,
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: NOTIFICATION_POLL_MS,
      retry: false,
    },
  );
  // Revalidate identity on mount/account changes before showing any cached inbox.
  const accountKey =
    identity.isFetchedAfterMount && !identity.isError
      ? (identity.data?.accountKey ?? null)
      : null;
  return (
    <NotificationInbox
      key={accountKey ?? "unavailable"}
      accountKey={accountKey}
      isOnline={isOnline}
      identityLoading={identity.isLoading}
      refreshIdentity={() => {
        void identity.refetch();
      }}
    />
  );
}

function NotificationInbox({
  accountKey,
  isOnline,
  identityLoading,
  refreshIdentity,
}: {
  accountKey: string | null;
  isOnline: boolean;
  identityLoading: boolean;
  refreshIdentity: () => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const input = { accountKey: accountKey ?? "" };
  const overview = api.notifications.overview.useQuery(input, {
    enabled: Boolean(accountKey) && isOnline,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: NOTIFICATION_POLL_MS,
    retry: false,
  });
  const list = api.notifications.list.useInfiniteQuery(
    { ...input, unreadOnly, limit: 30 },
    {
      enabled: Boolean(accountKey) && open && isOnline,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: open ? NOTIFICATION_POLL_MS : false,
      retry: false,
    },
  );
  const read = api.notifications.read.useMutation();
  const unreadCount = overview.isError ? 0 : (overview.data?.unreadCount ?? 0);
  const ring = useNotificationReminder(unreadCount, open);
  const hasUnread = unreadCount > 0;
  const items = list.isError
    ? []
    : (list.data?.pages.flatMap((page) => page.items) ?? []);

  const refresh = async () => {
    await Promise.all([
      utils.notifications.overview.invalidate(input),
      utils.notifications.list.invalidate(input),
      utils.drawingsWorkspace.notifications.invalidate(),
      utils.chat.getOverview.invalidate(),
      utils.conversations.list.invalidate(),
    ]);
  };
  const markRead = async (
    targets: NotificationReadTarget[],
    notification?: AppNotification,
  ) => {
    if (!accountKey || !isOnline || working) return;
    setWorking(true);
    setActionError(null);
    try {
      for (let start = 0; start < targets.length; start += 200) {
        if (!active.current) return;
        await read.mutateAsync({
          accountKey,
          targets: targets.slice(start, start + 200),
        });
      }
      await refresh();
      if (notification && active.current) {
        setOpen(false);
        router.push(notification.url);
      }
    } catch {
      if (active.current) {
        setActionError(
          "Could not mark notifications as read. Please try again.",
        );
        refreshIdentity();
      }
    } finally {
      if (active.current) setWorking(false);
    }
  };
  const visit = (notification: AppNotification) => {
    if (notification.unread) void markRead([notification.target], notification);
    else {
      setOpen(false);
      router.push(notification.url);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value && isOnline && accountKey) {
          void overview.refetch();
          void list.refetch();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-11 w-11 shrink-0",
            hasUnread && "bg-primary/10 text-primary hover:bg-primary/20",
          )}
          aria-label={
            hasUnread ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
        >
          {hasUnread ? (
            <BellRingIcon
              key={ring}
              className="notification-bell-ring h-5 w-5"
              data-ring={ring}
            />
          ) : (
            <BellIcon className="h-5 w-5" />
          )}
          {hasUnread && (
            <span
              aria-hidden="true"
              className="bg-destructive text-destructive-foreground absolute top-0 right-0 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold"
            >
              {notificationBadge(unreadCount)}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="p-5 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2">
            <BellIcon className="h-5 w-5" />
            Notifications
          </DialogTitle>
          <DialogDescription>
            {identityLoading || overview.isLoading || overview.isError
              ? "Your app activity, in one place."
              : hasUnread
                ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
                : "You're all caught up."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 border-y px-4 py-2">
          <div
            className="flex gap-1"
            role="group"
            aria-label="Filter notifications"
          >
            <Button
              size="sm"
              variant={unreadOnly ? "ghost" : "secondary"}
              aria-pressed={!unreadOnly}
              onClick={() => setUnreadOnly(false)}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={unreadOnly ? "secondary" : "ghost"}
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly(true)}
            >
              Unread
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={!hasUnread || working || !isOnline}
            onClick={() => {
              void markRead(overview.data?.readTargets ?? []);
            }}
          >
            {working ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheckIcon className="h-4 w-4" />
            )}
            Mark all read
          </Button>
        </div>
        <div
          className="min-h-40 overflow-y-auto overscroll-contain"
          aria-busy={list.isLoading || working}
        >
          {actionError && (
            <p role="alert" className="text-destructive px-5 py-3 text-sm">
              {actionError}
            </p>
          )}
          {!isOnline && (
            <p
              role="status"
              className="text-muted-foreground px-5 py-3 text-sm"
            >
              You&apos;re offline. Connect to refresh notifications.
            </p>
          )}
          {identityLoading || (accountKey && list.isLoading) ? (
            <p className="text-muted-foreground flex items-center justify-center gap-2 p-10 text-sm">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Loading notifications…
            </p>
          ) : !accountKey ? (
            <p className="text-muted-foreground p-8 text-center text-sm">
              Notifications are available for signed-in members with access to
              Jobs.
            </p>
          ) : list.isError || overview.isError ? (
            <div role="alert" className="p-8 text-center text-sm">
              <p>Could not load notifications.</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => {
                  refreshIdentity();
                  void overview.refetch();
                  void list.refetch();
                }}
              >
                <RefreshCwIcon className="h-4 w-4" />
                Try again
              </Button>
            </div>
          ) : !items.length ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 p-10 text-center text-sm">
              <BellIcon className="h-8 w-8 opacity-40" />
              <p>
                {unreadOnly
                  ? "No unread notifications."
                  : "No notifications yet."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    disabled={working || !isOnline}
                    onClick={() => visit(notification)}
                    className={cn(
                      "hover:bg-accent focus-visible:ring-ring flex w-full gap-3 px-5 py-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60",
                      notification.unread && "bg-primary/5",
                    )}
                  >
                    <span className="text-muted-foreground mt-0.5 shrink-0">
                      {notification.kind === "drawing" ? (
                        <FilePenLineIcon className="h-5 w-5" />
                      ) : (
                        <MessageSquareIcon className="h-5 w-5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span
                          className={cn(
                            "text-sm",
                            notification.unread && "font-semibold",
                          )}
                        >
                          {notification.title}
                        </span>
                        {notification.unread && (
                          <span className="bg-primary mt-1.5 h-2 w-2 shrink-0 rounded-full">
                            <span className="sr-only">Unread</span>
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                        {notification.context}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm [overflow-wrap:anywhere] break-words">
                        {notification.description}
                      </span>
                      <time
                        className="text-muted-foreground mt-2 block text-xs"
                        dateTime={notification.createdAt}
                        title={new Date(
                          notification.createdAt,
                        ).toLocaleString()}
                      >
                        {formatDistanceToNow(new Date(notification.createdAt), {
                          addSuffix: true,
                        })}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <div className="p-3 text-center">
              <Button
                size="sm"
                variant="ghost"
                disabled={list.isFetchingNextPage || !isOnline}
                onClick={() => {
                  void list.fetchNextPage();
                }}
              >
                {list.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {unreadCount} unread notifications
        </span>
      </DialogContent>
    </Dialog>
  );
}
