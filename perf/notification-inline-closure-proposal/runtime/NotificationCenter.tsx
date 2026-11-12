"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { Skeleton } from "~/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { isAppPageActive, subscribeAppPageActivity } from "~/lib/app-page-activity";
import { getBrowserOnlineStatus, useOnlineStatus } from "~/hooks/use-online-status";
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

function useNotificationAccount(sessionKey: string) {
  const utils = api.useUtils();
  const online = useOnlineStatus();
  const active = useSyncExternalStore(
    subscribeAppPageActivity,
    isAppPageActive,
    () => false,
  );
  const simulation = useEmployeeSimulation();
  const eligible = online && active;
  const lifecycle = useMemo(
    () => ({ sessionKey, simulationId: simulation?.id }),
    [sessionKey, simulation?.id],
  );
  const mounted = useRef<object | null>(null);
  const mountEpoch = useRef(0);
  useLayoutEffect(() => {
    mounted.current = lifecycle;
    const epoch = ++mountEpoch.current;
    setOwner(null);
    return () => {
      if (mounted.current === lifecycle) {
        mounted.current = null;
        mountEpoch.current = epoch + 1;
      }
    };
  }, [lifecycle, eligible]);
  const authorityEpoch = useRef(0);
  const [catchup, setCatchup] = useState(0);
  const [blocked, setBlocked] = useState<object | null>(null);
  const identityReceipt = useRef<{
    lifecycle: object;
    epoch: number;
    authority: number;
  } | null>(null);
  const identityAttempt = useRef<{
    lifecycle: object;
    epoch: number;
    authority: number;
  } | null>(null);
  const overviewAttempt = useRef<{
    lifecycle: object;
    account: object;
    epoch: number;
    authority: number;
  } | null>(null);
  const boundGeneration = useRef<object | null>(null);
  const boundAccount = useRef<string | null>(null);
  const current = useCallback(
    () =>
      mounted.current === lifecycle &&
      eligible &&
      getBrowserOnlineStatus() &&
      isAppPageActive(),
    [lifecycle, eligible],
  );
  const [binding, setBinding] = useState<{
    lifecycle: object;
    accountKey: string | null;
  } | null>(null);
  const [owner, setOwner] = useState<{
    lifecycle: object;
    accountKey: string;
  } | null>(null);
  const accountKey =
    binding?.lifecycle === lifecycle ? binding.accountKey : null;
  const accountGeneration = useMemo(() => ({ accountKey }), [accountKey]);
  useLayoutEffect(() => {
    boundAccount.current = accountKey;
    boundGeneration.current = accountGeneration;
  }, [accountKey, accountGeneration]);
  const overviewOwns =
    eligible &&
    Boolean(accountKey) &&
    owner?.lifecycle === lifecycle &&
    owner.accountKey === accountKey;
  const identity = useQuery({
    queryKey: getQueryKey(api.notifications.identity, { sessionKey }, "query"),
    queryFn: async ({ signal }) => {
      identityAttempt.current = {
        lifecycle,
        epoch: mountEpoch.current,
        authority: authorityEpoch.current,
      };
      const epoch = mountEpoch.current;
      const authority = authorityEpoch.current;
      let result;
      try {
        result = await utils.client.notifications.identity.query(
          { sessionKey },
          { signal },
        );
      } catch (error) {
        if (
          !signal.aborted &&
          current() &&
          epoch === mountEpoch.current &&
          authority === authorityEpoch.current
        ) {
          setBinding(null);
          setOwner(null);
        }
        throw error;
      }
      if (
        signal.aborted ||
        !current() ||
        epoch !== mountEpoch.current ||
        authority !== authorityEpoch.current
      )
        throw new DOMException(
          "Superseded notification identity",
          "AbortError",
        );
      identityReceipt.current = { lifecycle, epoch, authority };
      setBinding({ lifecycle, accountKey: result.accountKey });
      setBlocked(null);
      if (result.accountKey !== boundAccount.current) setOwner(null);
      return result;
    },
    enabled: eligible,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: overviewOwns ? false : NOTIFICATION_POLL_MS,
    retry: false,
  });
  const overview = useQuery({
    queryKey: getQueryKey(
      api.notifications.overview,
      { accountKey: accountKey ?? "" },
      "query",
    ),
    queryFn: async ({ signal }) => {
      const expected = accountKey;
      overviewAttempt.current = {
        lifecycle,
        account: accountGeneration,
        epoch: mountEpoch.current,
        authority: authorityEpoch.current,
      };
      const epoch = mountEpoch.current;
      const authority = authorityEpoch.current;
      try {
        const result = await utils.client.notifications.overview.query(
          { accountKey: expected ?? "" },
          { signal },
        );
        if (
          signal.aborted ||
          !current() ||
          boundAccount.current !== expected ||
          boundGeneration.current !== accountGeneration ||
          epoch !== mountEpoch.current ||
          authority !== authorityEpoch.current
        )
          throw new DOMException(
            "Superseded notification overview",
            "AbortError",
          );
        if (!expected || result.accountKey !== expected)
          throw Object.assign(new Error("Notification account changed"), {
            data: { code: "CONFLICT" },
          });
        const receipt = identityReceipt.current;
        if (
          receipt?.lifecycle === lifecycle &&
          receipt.epoch === mountEpoch.current &&
          receipt.authority === authorityEpoch.current
        ) {
          setOwner({ lifecycle, accountKey: expected });
        }
        return result;
      } catch (error) {
        if (
          !signal.aborted &&
          current() &&
          boundAccount.current === expected &&
          boundGeneration.current === accountGeneration &&
          epoch === mountEpoch.current &&
          authority === authorityEpoch.current
        ) {
          setOwner(null);
          const code = (error as { data?: { code?: string } }).data?.code;
          if (
            code === "UNAUTHORIZED" ||
            code === "FORBIDDEN" ||
            code === "CONFLICT"
          )
            setBlocked(lifecycle);
          // A response that began before this failure cannot certify recovery.
          // Keep the same overview key enabled: toggling it on every refusal
          // would form an identity-success -> overview-error request loop.
          authorityEpoch.current++;
          // This completed refusal already requested identity recovery. It is
          // not an old shared-key attempt that should be retried immediately.
          overviewAttempt.current = {
            lifecycle,
            account: accountGeneration,
            epoch,
            authority: authorityEpoch.current,
          };
          setCatchup((value) => value + 1);
        }
        throw error;
      }
    },
    enabled: eligible && Boolean(accountKey),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: NOTIFICATION_POLL_MS,
    retry: false,
  });
  const refetchIdentity = identity.refetch;
  const refetchOverview = overview.refetch;
  const overviewFetchStatus = overview.fetchStatus;
  const overviewFetched = overview.isFetched;
  // One bounded catchup per lifecycle/error, without cancelling a shared
  // in-flight request. If that request predates our authority epoch, wait for it
  // and then start one fresh RPC. A current failed attempt is not retried here.
  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    const expectedAuthority = authorityEpoch.current;
    const run = async () => {
      const attempted = identityAttempt.current;
      if (
        attempted?.lifecycle === lifecycle &&
        attempted.epoch === mountEpoch.current &&
        attempted.authority === expectedAuthority
      )
        return;
      await refetchIdentity({ cancelRefetch: false });
      const after = identityAttempt.current;
      if (
        !cancelled &&
        current() &&
        expectedAuthority === authorityEpoch.current &&
        (after?.lifecycle !== lifecycle ||
          after.epoch !== mountEpoch.current ||
          after.authority !== expectedAuthority)
      ) {
        await refetchIdentity({ cancelRefetch: false });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [eligible, lifecycle, catchup, current, refetchIdentity]);
  useEffect(() => {
    if (
      !eligible ||
      !accountKey ||
      overviewFetchStatus !== "idle" ||
      !overviewFetched ||
      (overviewAttempt.current?.lifecycle === lifecycle &&
        overviewAttempt.current.account === accountGeneration &&
        overviewAttempt.current.epoch === mountEpoch.current &&
        overviewAttempt.current.authority === authorityEpoch.current)
    )
      return;
    overviewAttempt.current = {
      lifecycle,
      account: accountGeneration,
      epoch: mountEpoch.current,
      authority: authorityEpoch.current,
    };
    void refetchOverview({ cancelRefetch: false });
  }, [
    eligible,
    accountKey,
    accountGeneration,
    lifecycle,
    overviewFetchStatus,
    overviewFetched,
    refetchOverview,
    catchup,
  ]);
  return {
    accountKey: blocked === lifecycle ? null : accountKey,
    online,
    identity,
    overview,
    refreshIdentity: () => {
      setOwner(null);
      authorityEpoch.current++;
      setCatchup((value) => value + 1);
    },
  };
}

export function NotificationCenter({
  sessionKey = "local",
}: {
  sessionKey?: string;
}) {
  return <NotificationAccountController key={sessionKey} sessionKey={sessionKey} />;
}

function NotificationAccountController({ sessionKey }: { sessionKey: string }) {
  const { accountKey, online, identity, overview, refreshIdentity } = useNotificationAccount(sessionKey);
  return (
    <NotificationInbox
      key={accountKey ?? "unavailable"}
      accountKey={accountKey}
      isOnline={online}
      identityLoading={identity.isLoading}
      refreshIdentity={refreshIdentity}
      overview={overview}
    />
  );
}

function NotificationInbox({
  accountKey,
  isOnline,
  identityLoading,
  refreshIdentity,
  overview,
}: {
  accountKey: string | null;
  isOnline: boolean;
  identityLoading: boolean;
  refreshIdentity: () => void;
  overview: ReturnType<typeof useNotificationAccount>["overview"];
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
  const unreadCount = !accountKey || overview.isError ? 0 : (overview.data?.unreadCount ?? 0);
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
              className="ring-background absolute -top-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-700 px-1.5 text-sm leading-none font-bold text-white tabular-nums shadow-sm ring-2"
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
                <div role="status" aria-label="Loading notifications" className="space-y-3 p-4">
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-14 rounded-lg w-full" />
                  ))}
                </div>
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
