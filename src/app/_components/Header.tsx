"use client";

import { useEffect, useState } from "react";
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
  ChevronDownIcon,
  DownloadIcon,
  MenuIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { APP_NAME } from "~/constants/app";
import { useOnlineStatus } from "~/hooks/use-online-status";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasUsableClerkKey =
  typeof publishableKey === "string" &&
  /^(pk|test|live)_/.test(publishableKey) &&
  publishableKey.length > 20;
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true)
  );
}

function HeaderFrame({
  pathname,
  mobileMenuOpen,
  setMobileMenuOpen,
  userEmail,
  signOut,
  showAccount,
  tabAccess,
  showAdmin,
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
    organization: boolean;
  };
  showAdmin: boolean;
}) {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const navLinks = [
    ...(tabAccess.dashboard
      ? [{ href: "/dashboard", label: "Dashboard" }]
      : []),
    ...(tabAccess.catalogue
      ? [{ href: "/dashboard/catalogue", label: "Catalogue" }]
      : []),
    ...(tabAccess.suppliers
      ? [{ href: "/dashboard/suppliers", label: "Suppliers" }]
      : []),
    ...(tabAccess.quotes
      ? [{ href: "/dashboard/quotes", label: "Quotes" }]
      : []),
    ...(tabAccess.orders
      ? [{ href: "/dashboard/orders", label: "Orders" }]
      : []),
    ...(tabAccess.organization
      ? [{ href: "/dashboard/organization", label: "Organization" }]
      : []),
    ...(showAdmin ? [{ href: "/admin", label: "Admin" }] : []),
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

  const showBackButton =
    pathname?.startsWith("/dashboard/jobs/") ||
    pathname?.startsWith("/dashboard/material-lists/");

  useEffect(() => {
    setIsInstalled(isStandaloneApp());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const navigate = (href: string) => {
    if (!isOnline) {
      window.location.href = href;
      return;
    }

    router.push(href);
  };

  const handleSignOut = async () => {
    await signOut?.();
  };

  const handleInstallApp = async () => {
    if (isInstalled) return;

    if (!installPrompt) {
      navigate("/dashboard/account");
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      setIsInstalled(true);
    }
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center gap-4 sm:gap-8">
        {showBackButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="h-10 px-2 sm:px-3"
            aria-label="Go back"
          >
            <ArrowLeftIcon className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="text-lg font-bold text-gray-900 sm:text-xl"
        >
          {APP_NAME}
        </button>
        <nav className="hidden gap-6 lg:flex">
          {navLinks.map((link) => (
            <button
              key={link.href}
              type="button"
              onClick={() => navigate(link.href)}
              className={`text-sm font-medium transition-colors ${
                isActive(link.href)
                  ? "text-gray-900 underline"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {link.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="hidden items-center gap-4 lg:flex">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-11 gap-2 px-3">
              <UserIcon className="h-5 w-5" />
              <ChevronDownIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex items-center gap-3">
                <UserIcon className="text-muted-foreground h-5 w-5" />
                <span className="truncate text-sm text-gray-700">
                  {userEmail}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {showAccount ? (
              <DropdownMenuItem onClick={() => navigate("/dashboard/account")}>
                Manage Account
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={handleInstallApp} disabled={isInstalled}>
              <DownloadIcon className="mr-2 h-4 w-4" />
              {isInstalled ? "App Installed" : "Install App"}
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

      {mobileMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-64 bg-white shadow-lg lg:hidden">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-4 py-4">
                <span className="font-semibold text-gray-900">Menu</span>
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
                  {navLinks.map((link) => (
                    <button
                      key={link.href}
                      onClick={() => {
                        setMobileMenuOpen(false);
                        navigate(link.href);
                      }}
                      className={`block w-full rounded-md px-3 py-3 text-left text-base font-medium transition-colors ${
                        isActive(link.href)
                          ? "bg-gray-100 text-gray-900"
                          : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              </nav>
              <div className="border-t px-4 py-4">
                <div className="mb-3 flex items-center gap-3 rounded-md px-3 py-2">
                  <UserIcon className="text-muted-foreground h-5 w-5" />
                  <span className="truncate text-sm text-gray-700">
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
                      className="block w-full rounded-md px-3 py-2 text-left text-base font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
                    >
                      Manage Account
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void handleInstallApp();
                    }}
                    disabled={isInstalled}
                    className="block w-full rounded-md px-3 py-2 text-left text-base font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:text-gray-400"
                  >
                    {isInstalled ? "App Installed" : "Install App"}
                  </button>
                  {signOut ? (
                    <button
                      onClick={() => {
                        setMobileMenuOpen(false);
                        void handleSignOut();
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left text-base font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
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
  const { data: userRole } = api.user.getMyRole.useQuery(undefined, {
    enabled: !!user && isOnline,
  });

  return (
    <HeaderFrame
      pathname={pathname}
      mobileMenuOpen={mobileMenuOpen}
      setMobileMenuOpen={setMobileMenuOpen}
      userEmail={user?.primaryEmailAddress?.emailAddress ?? "Not signed in"}
      signOut={async () => {
        try {
          await fetch("/api/auth/signout", { method: "POST" });
        } finally {
          await signOut({ redirectUrl: "/sign-in" });
        }
      }}
      showAccount={true}
      tabAccess={
        userRole?.permissions.tabAccess ?? {
          dashboard: true,
          catalogue: true,
          suppliers: true,
          quotes: true,
          orders: true,
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
        organization: false,
      }}
      showAdmin={false}
    />
  );
}

export function Header() {
  return hasUsableClerkKey ? <HeaderWithClerk /> : <HeaderWithoutClerk />;
}
