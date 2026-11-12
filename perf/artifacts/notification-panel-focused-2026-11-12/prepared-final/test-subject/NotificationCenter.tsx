"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  BellIcon,
  BellRingIcon,
  CheckCheckIcon,
  Loader2Icon,
  Settings2Icon,
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
import { useNotificationAccount } from "~/hooks/use-notification-account";
import {
  notificationBadge,
  NOTIFICATION_POLL_MS,
  type AppNotification,
  type NotificationReadTarget,
} from "~/lib/app-notifications";
import { cn } from "~/lib/utils";
import { useNotificationReminder } from "~/components/notifications/use-notification-reminder";
import type { NotificationPanelProps } from "~/components/notifications/NotificationPanel";
import { loadTestPanel } from "../test-loader";

const loadPanel = loadTestPanel;

export function NotificationCenter({
  sessionKey = "local",
}: {
  sessionKey?: string;
}) {
  return (
    <NotificationAccountController key={sessionKey} sessionKey={sessionKey} />
  );
}

function NotificationAccountController({ sessionKey }: { sessionKey: string }) {
  const { accountKey, online, identity, overview, refreshIdentity } =
    useNotificationAccount(sessionKey);
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
  const [Panel, setPanel] =
    useState<ComponentType<NotificationPanelProps> | null>(null);
  const [panelError, setPanelError] = useState(false);
  const [panelAttempt, setPanelAttempt] = useState(0);
  useEffect(() => {
    if (!open || Panel || panelError) return;
    let cancelled = false;
    void loadPanel().then(
      (module) => {
        if (!cancelled) setPanel(() => module.default);
      },
      () => {
        if (!cancelled) setPanelError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, Panel, panelError, panelAttempt]);
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
  const unreadCount =
    !accountKey || overview.isError ? 0 : (overview.data?.unreadCount ?? 0);
  useEffect(() => {
    // Never replace the signed-in device badge with a simulated employee's
    // count, stale cached data, or a failed/offline request's fallback zero.
    if (
      simulation ||
      !accountKey ||
      !isOnline ||
      overview.isError ||
      !overview.isFetchedAfterMount ||
      !overview.data
    )
      return;
    void updateAppBadge(overview.data.unreadCount);
  }, [
    simulation,
    accountKey,
    isOnline,
    overview.isError,
    overview.isFetchedAfterMount,
    overview.data,
  ]);
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
        {open &&
          (Panel ? (
            <Panel
              accountKey={accountKey}
              isOnline={isOnline}
              settingsOpen={settingsOpen}
              actionError={actionError}
              identityLoading={identityLoading}
              listLoading={list.isLoading}
              listError={list.isError}
              overviewError={overview.isError}
              unreadOnly={unreadOnly}
              working={working}
              items={items}
              hasNextPage={list.hasNextPage}
              isFetchingNextPage={list.isFetchingNextPage}
              setUnreadOnly={setUnreadOnly}
              onRefresh={() => {
                refreshIdentity();
                void overview.refetch();
                void list.refetch();
              }}
              onVisit={visit}
              onLoadMore={() => {
                void list.fetchNextPage();
              }}
            />
          ) : panelError ? (
            <div role="alert" className="space-y-3 p-4 text-sm">
              <p>Notifications could not be loaded.</p>
              <Button
                variant="outline"
                onClick={() => {
                  setPanelError(false);
                  setPanelAttempt((attempt) => attempt + 1);
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <p role="status" className="p-4 text-sm">
              Loading notifications…
            </p>
          ))}
        <span className="sr-only" role="status" aria-live="polite">
          {unreadCount} unread notifications
        </span>
      </DialogContent>
    </Dialog>
  );
}
