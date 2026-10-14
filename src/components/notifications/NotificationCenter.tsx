"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format, isToday, isYesterday } from "date-fns";
import {
  ArrowLeftIcon,
  BellIcon,
  BellRingIcon,
  CheckCheckIcon,
  FilePenLineIcon,
  Loader2Icon,
  MessageSquareIcon,
  PackageIcon,
  RefreshCwIcon,
  Settings2Icon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import { useEmployeeSimulation } from "~/components/simulation/SimulationProvider";
import { updateAppBadge } from "~/lib/app-badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
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
  type NotificationKind,
  type NotificationReadTarget,
} from "~/lib/app-notifications";
import { cn } from "~/lib/utils";
import { useNotificationReminder } from "./use-notification-reminder";
import { PushNotifications } from "./PushNotifications";
import { JobNotificationSettings } from "./JobNotificationSettings";

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
  const simulation = useEmployeeSimulation();
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  useEffect(() => {
    // Never replace the signed-in device badge with a simulated employee's
    // count, stale cached data, or a failed/offline request's fallback zero.
    if (simulation || !accountKey || !isOnline || overview.isError ||
        !overview.isFetchedAfterMount || !overview.data) return;
    void updateAppBadge(overview.data.unreadCount);
  }, [simulation, accountKey, isOnline, overview.isError, overview.isFetchedAfterMount, overview.data]);
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

  const groups = groupByDay(items);
  const showList = !settingsOpen;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setSettingsOpen(false);
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
              className="bg-destructive text-destructive-foreground ring-background absolute top-0.5 right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold ring-2"
            >
              {notificationBadge(unreadCount)}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="bg-canvas flex h-[min(42rem,85dvh)] w-full max-w-full flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg"
      >
        <DialogHeader className="bg-background gap-0 border-b px-4 pt-3 pb-3 text-left">
          <div className="flex items-center gap-2">
            {settingsOpen && (
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 h-9 w-9"
                aria-label="Back to notifications"
                onClick={() => setSettingsOpen(false)}
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </Button>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <DialogTitle className="truncate text-lg font-semibold">
                {settingsOpen ? "Notification settings" : "Notifications"}
              </DialogTitle>
              {!settingsOpen && hasUnread && (
                <span
                  aria-hidden="true"
                  className="bg-primary text-primary-foreground rounded-full px-2 py-1 text-xs leading-none font-semibold tabular-nums"
                >
                  {notificationBadge(unreadCount)}
                </span>
              )}
            </div>
            {!settingsOpen && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-9 w-9"
                aria-label="Notification settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings2Icon className="h-5 w-5" />
              </Button>
            )}
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground -mr-2 h-9 w-9"
                aria-label="Close"
              >
                <XIcon className="h-5 w-5" />
              </Button>
            </DialogClose>
          </div>
          <DialogDescription
            className={cn("mt-0.5 text-xs", !settingsOpen && "sr-only")}
          >
            {settingsOpen
              ? "Choose how and where you hear about activity."
              : identityLoading || overview.isLoading || overview.isError
                ? "Your app activity, in one place."
                : hasUnread
                  ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
                  : "You're all caught up."}
          </DialogDescription>
          {showList && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <div
                className="bg-muted inline-flex rounded-lg p-1"
                role="group"
                aria-label="Filter notifications"
              >
                {(
                  [
                    ["Unread", true],
                    ["All", false],
                  ] as const
                ).map(([label, value]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={unreadOnly === value}
                    onClick={() => setUnreadOnly(value)}
                    className={cn(
                      "focus-visible:ring-ring h-8 rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      unreadOnly === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-primary hover:text-primary h-8 px-2"
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
          )}
        </DialogHeader>
        <div
          className="min-h-40 flex-1 overflow-y-auto overscroll-contain"
          aria-busy={list.isLoading || working}
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
              {identityLoading || (accountKey && list.isLoading) ? (
                <p className="text-muted-foreground flex items-center justify-center gap-2 p-10 text-sm">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  Loading notifications…
                </p>
              ) : !accountKey ? (
                <EmptyState
                  title="Notifications unavailable"
                  text="Notifications are available for signed-in members with access to Jobs."
                />
              ) : list.isError || overview.isError ? (
                <div role="alert" className="p-8 text-center text-sm">
                  <p>Could not load notifications.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
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
                              onSelect={() => visit(notification)}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
              {list.hasNextPage && (
                <div className="px-4 pb-4 text-center">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={list.isFetchingNextPage || !isOnline}
                    onClick={() => {
                      void list.fetchNextPage();
                    }}
                  >
                    {list.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {unreadCount} unread notifications
        </span>
      </DialogContent>
    </Dialog>
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
