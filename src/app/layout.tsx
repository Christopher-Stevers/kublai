import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Geist } from "next/font/google";

import { SessionProviderWrapper } from "./_components/SessionProviderWrapper";
import { TRPCReactProvider } from "~/trpc/react";
import { APP_NAME } from "~/constants/app";
import { ClientConsoleErrorReporter } from "~/components/debug/ClientConsoleErrorReporter";
import { PushAccountBinding } from "~/components/notifications/PushNotifications";
import { ServiceWorkerRegistration } from "~/components/offline/ServiceWorkerRegistration";
import { ThemeProvider } from "~/components/app/ThemeProvider";
import { AppDialogHost } from "~/components/ui/app-dialogs";
import { THEME_BOOT_SCRIPT } from "~/lib/theme-document";

export const metadata: Metadata = {
  title: `${APP_NAME} - Simplified Parts Ordering for Trades Foremen`,
  description:
    "ForemanHQ helps plumbers quickly and easily order parts and supplies for their job sites. Stop texting and manage orders all in one place.",
  keywords: [
    "trades",
    "foreman",
    "parts ordering",
    "construction",
    "job site management",
    "order supplies",
    "trade contractor",
    "materials management",
    "foreman app",
    "construction tools",
    "order tracking",
  ],
  manifest: "/manifest.webmanifest",
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: [
    {
      rel: "icon",
      type: "image/png",
      sizes: "16x16",
      url: "/foremanhq/icon-dark-v2-16.png",
    },
    {
      rel: "icon",
      type: "image/png",
      sizes: "32x32",
      url: "/foremanhq/icon-dark-v2-32.png",
    },
    { rel: "apple-touch-icon", url: "/foremanhq/icon-dark-v2-180.png" },
    {
      rel: "icon",
      type: "image/png",
      sizes: "192x192",
      url: "/foremanhq/icon-dark-v2-192.png",
    },
    {
      rel: "icon",
      type: "image/png",
      sizes: "512x512",
      url: "/foremanhq/icon-dark-v2-512.png",
    },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#111827",
  colorScheme: "light dark",
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

// Chrome offers installation once, possibly before the app's code loads:
// hold on to the offer from the very start (picked up by install-prompt.ts).
const installCaptureScript = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__foremanhqInstallPrompt=e;});`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: installCaptureScript }} />
      </head>
      <body>
        <ThemeProvider>
          <SessionProviderWrapper>
            <TRPCReactProvider>
              <ClientConsoleErrorReporter />
              <ServiceWorkerRegistration />
              <PushAccountBinding />
              {children}
              <AppDialogHost />
            </TRPCReactProvider>
          </SessionProviderWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
