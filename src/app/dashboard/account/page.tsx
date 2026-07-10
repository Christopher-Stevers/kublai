"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import {
  Loader2,
  ExternalLink,
  WifiOffIcon,
  DownloadIcon,
  CheckCircle2Icon,
  MailIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  EMAIL_CLIENT_OPTIONS,
  type EmailClientPreference,
  getPreferredEmailClient,
  setPreferredEmailClient,
} from "~/lib/mailto";
import { useThemePreference } from "~/components/app/ThemeProvider";
import { type ThemePreference } from "~/lib/theme";

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

function isAppleTouchDevice() {
  if (typeof window === "undefined") return false;
  const navigatorWithTouch = window.navigator as Navigator & {
    maxTouchPoints?: number;
  };
  return (
    /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" &&
      (navigatorWithTouch.maxTouchPoints ?? 0) > 1)
  );
}

export default function AccountPage() {
  const [isCreatingPortal, setIsCreatingPortal] = useState(false);
  const [name, setName] = useState("");
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [usesAppleInstallFlow, setUsesAppleInstallFlow] = useState(false);
  const [emailClient, setEmailClient] =
    useState<EmailClientPreference>("default");
  const isOnline = useOnlineStatus();
  const utils = api.useUtils();
  const { theme, setTheme } = useThemePreference();

  const { data: me } = api.user.getMe.useQuery(undefined, {
    enabled: isOnline,
  });

  useEffect(() => {
    if (me?.name) setName(me.name);
  }, [me?.name]);

  useEffect(() => {
    setIsInstalled(isStandaloneApp());
    setUsesAppleInstallFlow(isAppleTouchDevice());
    setEmailClient(getPreferredEmailClient());

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

  const { data: status, isLoading } =
    api.payment.getSubscriptionStatus.useQuery(undefined, {
      enabled: isOnline,
    });
  const createPortalSession = api.payment.createPortalSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      setIsCreatingPortal(false);
    },
  });
  const updateProfile = api.user.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.user.getMe.invalidate();
    },
  });

  const handleManageSubscription = () => {
    if (!isOnline) return;
    setIsCreatingPortal(true);
    createPortalSession.mutate();
  };

  const handleSaveProfile = () => {
    if (!isOnline || !name.trim()) return;
    updateProfile.mutate({ name: name.trim() });
  };

  const handleInstallApp = async () => {
    if (!installPrompt || isInstalled) return;

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      setIsInstalled(true);
    }
  };

  const handleEmailClientChange = (client: EmailClientPreference) => {
    setEmailClient(client);
    setPreferredEmailClient(client);
  };

  const themeOptions: {
    value: ThemePreference;
    label: string;
    icon: typeof SunIcon;
  }[] = [
    { value: "system", label: "System", icon: MonitorIcon },
    { value: "light", label: "Light", icon: SunIcon },
    { value: "dark", label: "Dark", icon: MoonIcon },
  ];

  if (isLoading && isOnline) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900 sm:mb-8 sm:text-3xl">
            Account
          </h1>
          <Card>
            <CardContent className="p-6 sm:p-8">
              <p className="text-center text-gray-600">Loading...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-gray-900 sm:mb-8 sm:text-3xl">
          Account
        </h1>
        <div className="space-y-6 sm:space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isOnline && (
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
                  <WifiOffIcon className="h-3 w-3" /> Profile changes require
                  internet
                </div>
              )}
              <div className="space-y-1">
                <label
                  htmlFor="account-name"
                  className="text-sm font-medium text-gray-900"
                >
                  Name
                </label>
                <Input
                  id="account-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  disabled={!isOnline || updateProfile.isPending}
                />
                <p className="text-muted-foreground text-xs">
                  This name is used to sign generated order emails.
                </p>
              </div>
              <Button
                onClick={handleSaveProfile}
                disabled={
                  !isOnline ||
                  !name.trim() ||
                  updateProfile.isPending ||
                  name.trim() === (me?.name ?? "")
                }
              >
                {updateProfile.isPending ? "Saving..." : "Save Name"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>App</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900">
                  Install ForemenHQ
                </p>
                <p className="text-muted-foreground text-sm">
                  Add the app to your device for a faster, full-screen
                  experience.
                </p>
              </div>

              {isInstalled ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-900">
                  <CheckCircle2Icon className="h-3 w-3" /> App installed
                </div>
              ) : installPrompt ? (
                <Button onClick={handleInstallApp} className="w-full sm:w-auto">
                  <DownloadIcon className="mr-2 h-4 w-4" /> Install App
                </Button>
              ) : (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  <p className="font-medium text-gray-900">
                    {usesAppleInstallFlow
                      ? "Use Add to Home Screen"
                      : "Install from the browser menu"}
                  </p>
                  <p className="mt-1 text-sm text-gray-600">
                    {usesAppleInstallFlow
                      ? "On iPad, open the browser share menu and choose Add to Home Screen."
                      : "Open your browser menu and choose Install app or Add to Home Screen."}
                  </p>
                </div>
              )}

              <div className="border-t border-gray-200 pt-4">
                <p className="mb-2 text-sm font-medium text-gray-900">
                  Appearance
                </p>
                <div className="grid grid-cols-3 gap-2 sm:max-w-sm">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const isSelected = theme === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setTheme(option.value)}
                        className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 text-sm font-medium transition-colors ${
                          isSelected
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                        aria-pressed={isSelected}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  Saved on this device.
                </p>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <label
                  htmlFor="email-client"
                  className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900"
                >
                  <MailIcon className="h-4 w-4 text-gray-500" />
                  Email client
                </label>
                <select
                  id="email-client"
                  value={emailClient}
                  onChange={(event) =>
                    handleEmailClientChange(
                      event.target.value as EmailClientPreference,
                    )
                  }
                  className="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:max-w-xs"
                >
                  {EMAIL_CLIENT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-muted-foreground mt-2 text-xs">
                  Orders open with this choice on the current device.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Account Type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isOnline && (
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
                  <WifiOffIcon className="h-3 w-3" /> Account billing requires
                  internet
                </div>
              )}
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    status?.hasManagingAccount
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-gray-200 bg-gray-50 text-gray-700"
                  }
                >
                  {status?.accountTypeLabel ?? "Standard Account"}
                </Badge>
                <span className="text-sm text-gray-600">
                  {status?.hasManagingAccount
                    ? "You can manage lists, generate quotes, and generate orders."
                    : "You can use the dashboard with standard account permissions."}
                </span>
              </div>

              {status?.hasActiveSubscription && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">
                      Subscription Status:
                    </span>
                    <Badge variant="outline">
                      {status.subscriptionStatus ?? "Unknown"}
                    </Badge>
                  </div>
                  {status.subscriptionEndsAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        Renews:
                      </span>
                      <span className="text-sm text-gray-600">
                        {new Date(
                          status.subscriptionEndsAt,
                        ).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={handleManageSubscription}
                    disabled={!isOnline || isCreatingPortal}
                    variant="outline"
                    className="w-full"
                  >
                    {isCreatingPortal ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        Manage Subscription
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              )}

              {status?.hasOneTimeAccess && status.oneTimePurchaseDate && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">
                      Purchase Type:
                    </span>
                    <Badge variant="outline">One-Time Purchase</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">
                      Purchased:
                    </span>
                    <span className="text-sm text-gray-600">
                      {new Date(
                        status.oneTimePurchaseDate,
                      ).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              )}

              {isOnline && !status?.hasManagingAccount && (
                <Button asChild className="w-full">
                  <a href="/pricing">Upgrade to Managing Account</a>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
