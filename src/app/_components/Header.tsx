"use client";

import { InstallAppButton } from "~/components/app/InstallAppButton";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useUser, useClerk } from "@clerk/nextjs";
import { api } from "~/trpc/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import {
  ArrowLeftIcon,
  CameraIcon,
  MessageSquareIcon,
  BookOpenIcon,
  BriefcaseIcon,
  Building2Icon,
  ChevronDownIcon,
  FileTextIcon,
  MenuIcon,
  ReceiptIcon,
  ShieldIcon,
  ShoppingCartIcon,
  TruckIcon,
  WrenchIcon,
  ClockIcon,
  UserIcon,
  SettingsIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useSnapshot } from "~/components/chat/SnapshotProvider";
import { cn } from "~/lib/utils";
import { APP_NAME } from "~/constants/app";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  HEADER_BACK_STATE_EVENT,
  requestHeaderBack,
  runHeaderBackOverride,
  type HeaderBackStateDetail,
} from "~/lib/header-back-events";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import {
  EndSimulationButton,
  useEmployeeSimulation,
} from "~/components/simulation/SimulationProvider";
import { NotificationCenter } from "~/components/notifications/NotificationCenter";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasUsableClerkKey =
  typeof publishableKey === "string" &&
  /^(pk|test|live)_/.test(publishableKey) &&
  publishableKey.length > 20;

function HeaderFrame({
  pathname,
  mobileMenuOpen,
  setMobileMenuOpen,
  userEmail,
  signOut,
  showAccount,
  tabAccess,
  showAdmin,
  sessionKey,
}: {
  pathname: string | null;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  userEmail: string;
  signOut?: () => void | Promise<void>;
  showAccount: boolean;
  tabAccess: {
    dashboard: boolean;
    catalogue: boolean;
    suppliers: boolean;
    quotes: boolean;
    orders: boolean;
    draws: boolean;
    assets: boolean;
    timesheets: boolean;
    organization: boolean;
  };
  showAdmin: boolean;
  sessionKey?: string;
}) {
  const simulation = useEmployeeSimulation();
  const router = useRouter();
  const snapshot = useSnapshot();
  const sandbox = useTutorialSandbox();
  const isOnline = useOnlineStatus();
  const [showRequestedBackButton, setShowRequestedBackButton] = useState(false);
  const navLinks: { href: string; label: string; icon: LucideIcon }[] = [
    ...(tabAccess.dashboard
      ? [
          { href: "/dashboard", label: "Jobs", icon: BriefcaseIcon },
          { href: "/dashboard/chat", label: "Chat", icon: MessageSquareIcon },
        ]
      : []),
    ...(tabAccess.catalogue
      ? [
          {
            href: "/dashboard/catalogue",
            label: "Catalogue",
            icon: BookOpenIcon,
          },
        ]
      : []),
    ...(tabAccess.suppliers
      ? [{ href: "/dashboard/suppliers", label: "Suppliers", icon: TruckIcon }]
      : []),
    ...(tabAccess.quotes
      ? [{ href: "/dashboard/quotes", label: "Quotes", icon: FileTextIcon }]
      : []),
    ...(tabAccess.orders
      ? [{ href: "/dashboard/orders", label: "Orders", icon: ShoppingCartIcon }]
      : []),
    ...(tabAccess.draws
      ? [{ href: "/dashboard/draws", label: "Draws", icon: ReceiptIcon }]
      : []),
    ...(tabAccess.timesheets
      ? [
          {
            href: "/dashboard/timesheets",
            label: "Timesheets",
            icon: ClockIcon,
          },
        ]
      : []),
    ...(tabAccess.assets
      ? [
          {
            href: "/dashboard/assets",
            label: "Asset Management",
            icon: WrenchIcon,
          },
        ]
      : []),
    ...(tabAccess.organization
      ? [
          {
            href: "/dashboard/organization",
            label: "Organization",
            icon: Building2Icon,
          },
        ]
      : []),
    ...(showAdmin
      ? [{ href: "/admin", label: "Admin", icon: ShieldIcon }]
      : []),
  ];
  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return (
        pathname === "/dashboard" ||
        (pathname?.startsWith("/dashboard/jobs/") ?? false) ||
        (pathname?.startsWith("/dashboard/material-lists/") ?? false)
      );
    }
    return pathname?.startsWith(href);
  };

  const showRouteBackButton =
    (pathname?.startsWith("/dashboard/jobs/") ?? false) ||
    (pathname?.startsWith("/dashboard/material-lists/") ?? false) ||
    pathname === "/dashboard/account/settings";
  const showBackButton = showRouteBackButton || showRequestedBackButton;

  useEffect(() => {
    const handleBackState = (event: Event) => {
      const detail = (event as CustomEvent<HeaderBackStateDetail>).detail;
      setShowRequestedBackButton(Boolean(detail?.visible));
    };

    window.addEventListener(HEADER_BACK_STATE_EVENT, handleBackState);

    return () => {
      window.removeEventListener(HEADER_BACK_STATE_EVENT, handleBackState);
    };
  }, []);

  const navigate = (href: string) => {
    if (sandbox) return;
    if (!isOnline) {
      window.location.href = href;
      return;
    }

    router.push(href);
  };

  const handleSignOut = async () => {
    if (sandbox) return;
    try {
      const { clearDrawingDownloadsOnSignOut } =
        await import("~/components/jobs/DrawingAccountProvider");
      await clearDrawingDownloadsOnSignOut();
    } catch {
      /* Signing out must still work if offline storage is unavailable. */
    }
    try {
      const { disconnectPushDevice } =
        await import("~/components/notifications/PushNotifications");
      await disconnectPushDevice();
    } catch {
      // Local revocation is retained for retry; signing out must still work offline.
    } finally {
      await signOut?.();
    }
  };

  const handleBack = () => {
    if (runHeaderBackOverride()) return;
    if (showRequestedBackButton) {
      requestHeaderBack();
      return;
    }

    if (!sandbox) router.back();
  };

  return (
    <header className="border-border bg-card sticky top-0 z-50 flex h-14 items-center justify-between border-b px-3 shadow-[0_2px_3px_rgba(0,0,0,0.35),0_6px_16px_rgba(0,0,0,0.6)] sm:h-16 sm:px-6 [[data-flat-header]_&]:border-b-transparent [[data-flat-header]_&]:shadow-none">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-8">
        {showBackButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="h-10 w-10 shrink-0"
            aria-label="Go back"
            data-tutorial="back"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </Button>
        )}
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="text-foreground flex min-w-0 items-center gap-2 text-lg font-bold tracking-tight lg:shrink-0"
        >
          <Image
            src="/foremanhq/icon-dark-v2-32.png"
            alt=""
            width={28}
            height={28}
            className="shrink-0 rounded-md"
            priority
          />
          <span className={cn("truncate", simulation && "hidden sm:inline")}>
            {APP_NAME}
          </span>
        </button>
        <EndSimulationButton />
        <nav className="hidden min-w-0 items-center gap-1 overflow-x-auto lg:flex">
          {navLinks.map((link) => (
            <button
              key={link.href}
              type="button"
              onClick={() => navigate(link.href)}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                isActive(link.href)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {link.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="ml-2 flex shrink-0 items-center gap-2">
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          {tabAccess.dashboard && (
            <Button
              variant="ghost"
              aria-label="Snapshot"
              onClick={() => {
                if (!sandbox) snapshot?.start();
              }}
            >
              <CameraIcon className="h-4 w-4" />
              Snapshot
            </Button>
          )}
        </div>
        <InstallAppButton compact />
        {!sandbox && (
          <NotificationCenter key={sessionKey} sessionKey={sessionKey} />
        )}
        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-11 gap-2 px-3"
                aria-label="User menu"
              >
                <UserIcon className="h-5 w-5" />
                <ChevronDownIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex items-center gap-3">
                  <UserIcon className="text-muted-foreground h-5 w-5" />
                  <span className="text-foreground/80 truncate text-sm">
                    {userEmail}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {showAccount ? (
                <DropdownMenuItem
                  onClick={() => navigate("/dashboard/account")}
                >
                  Manage Account
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={() => navigate("/dashboard/account/settings")}
              >
                <SettingsIcon className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              {signOut ? (
                <DropdownMenuItem
                  onClick={() => {
                    void handleSignOut();
                  }}
                >
                  Sign out
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="ml-auto flex items-center gap-2 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <XIcon className="h-6 w-6" />
            ) : (
              <MenuIcon className="h-6 w-6" />
            )}
          </Button>
        </div>
      </div>

      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="bg-card fixed inset-y-0 right-0 z-50 w-64 shadow-lg lg:hidden">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-4 py-4">
                <span className="text-foreground font-semibold">Menu</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close menu"
                >
                  <XIcon className="h-5 w-5" />
                </Button>
              </div>
              <nav className="flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-1">
                  {tabAccess.dashboard && (
                    <button
                      type="button"
                      className="text-foreground/80 hover:bg-accent flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-base font-medium"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        if (!sandbox) snapshot?.start();
                      }}
                    >
                      <CameraIcon className="h-5 w-5 shrink-0" />
                      Snapshot
                    </button>
                  )}
                  {navLinks.map((link) => (
                    <button
                      key={link.href}
                      onClick={() => {
                        setMobileMenuOpen(false);
                        navigate(link.href);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-base font-medium transition-colors",
                        isActive(link.href)
                          ? "bg-primary/10 text-primary"
                          : "text-foreground/80 hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <link.icon className="h-5 w-5 shrink-0" />
                      {link.label}
                    </button>
                  ))}
                </div>
              </nav>
              <div className="border-t px-4 py-4">
                <div className="mb-3 flex items-center gap-3 rounded-md px-3 py-2">
                  <UserIcon className="text-muted-foreground h-5 w-5" />
                  <span className="text-foreground/80 truncate text-sm">
                    {userEmail}
                  </span>
                </div>
                <div className="space-y-1">
                  {showAccount ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        navigate("/dashboard/account");
                      }}
                      className="text-foreground/80 hover:bg-accent hover:text-foreground block w-full rounded-md px-3 py-2 text-left text-base font-medium transition-colors"
                    >
                      Manage Account
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      navigate("/dashboard/account/settings");
                    }}
                    className="text-foreground/80 hover:bg-accent flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-base font-medium"
                  >
                    <SettingsIcon className="h-4 w-4" /> Settings
                  </button>
                  {signOut ? (
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        void handleSignOut();
                      }}
                      className="text-foreground/80 hover:bg-accent hover:text-foreground block w-full rounded-md px-3 py-2 text-left text-base font-medium transition-colors"
                    >
                      Sign out
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
}

function HeaderWithClerk() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user } = useUser();
  const { signOut } = useClerk();
  const isOnline = useOnlineStatus();
  const simulation = useEmployeeSimulation();
  const { data: effectiveUser } = api.user.getMe.useQuery(undefined, {
    enabled: isOnline,
  });
  const { data: userRole } = api.user.getMyRole.useQuery(undefined, {
    enabled: isOnline,
  });

  return (
    <HeaderFrame
      pathname={pathname}
      mobileMenuOpen={mobileMenuOpen}
      setMobileMenuOpen={setMobileMenuOpen}
      userEmail={
        simulation?.employeeEmail ??
        effectiveUser?.email ??
        user?.primaryEmailAddress?.emailAddress ??
        "Not signed in"
      }
      signOut={async () => {
        try {
          await fetch("/api/auth/signout", { method: "POST" });
        } finally {
          await signOut({ redirectUrl: "/sign-in" });
        }
      }}
      showAccount={true}
      sessionKey={
        simulation?.employeeId ?? effectiveUser?.id ?? user?.id ?? "guest"
      }
      tabAccess={
        userRole?.permissions.tabAccess ?? {
          dashboard: true,
          catalogue: true,
          suppliers: true,
          quotes: true,
          orders: true,
          draws: false,
          assets: true,
          timesheets: true,
          organization: false,
        }
      }
      showAdmin={userRole?.role === "admin"}
    />
  );
}

function HeaderWithoutClerk() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <HeaderFrame
      pathname={pathname}
      mobileMenuOpen={mobileMenuOpen}
      setMobileMenuOpen={setMobileMenuOpen}
      userEmail="Auth disabled"
      showAccount={false}
      tabAccess={{
        dashboard: true,
        catalogue: true,
        suppliers: true,
        quotes: true,
        orders: true,
        draws: false,
        assets: true,
        timesheets: true,
        organization: false,
      }}
      showAdmin={false}
    />
  );
}

export function Header() {
  const sandbox = useTutorialSandbox();
  if (sandbox) return <HeaderForPractice />;
  return hasUsableClerkKey ? <HeaderWithClerk /> : <HeaderWithoutClerk />;
}

function HeaderForPractice() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  return (
    <HeaderFrame
      pathname="/dashboard"
      mobileMenuOpen={mobileMenuOpen}
      setMobileMenuOpen={setMobileMenuOpen}
      userEmail="Practice workspace"
      showAccount={true}
      tabAccess={{
        dashboard: true,
        catalogue: true,
        suppliers: true,
        quotes: true,
        orders: true,
        draws: false,
        assets: true,
        timesheets: false,
        organization: false,
      }}
      showAdmin={false}
    />
  );
}
