import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Geist } from "next/font/google";

import { SessionProviderWrapper } from "./_components/SessionProviderWrapper";
import { TRPCReactProvider } from "~/trpc/react";
import { APP_NAME } from "~/constants/app";
import { ClientConsoleErrorReporter } from "~/components/debug/ClientConsoleErrorReporter";
import { ServiceWorkerRegistration } from "~/components/offline/ServiceWorkerRegistration";
import { StartupSplash } from "~/components/app/StartupSplash";
import { ThemeProvider } from "~/components/app/ThemeProvider";

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
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: [
    { rel: "icon", url: "/foremanhq/favicon.ico" },
    {
      rel: "icon",
      type: "image/png",
      sizes: "16x16",
      url: "/foremanhq/favicon-16x16.png",
    },
    {
      rel: "icon",
      type: "image/png",
      sizes: "32x32",
      url: "/foremanhq/favicon-32x32.png",
    },
    { rel: "apple-touch-icon", url: "/foremanhq/apple-touch-icon.png" },
    {
      rel: "icon",
      type: "image/png",
      sizes: "192x192",
      url: "/foremanhq/android-chrome-192x192.png",
    },
    {
      rel: "icon",
      type: "image/png",
      sizes: "512x512",
      url: "/foremanhq/android-chrome-512x512.png",
    },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#f9fafb",
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const themeBootScript = `
(() => {
  try {
    const theme = localStorage.getItem("foremenhq-theme") || "system";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const useDark = theme === "dark" || (theme === "system" && prefersDark);
    document.documentElement.classList.toggle("dark", useDark);
    document.documentElement.style.colorScheme = useDark ? "dark" : "light";
  } catch {
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <StartupSplash />
        <ThemeProvider>
          <SessionProviderWrapper>
            <TRPCReactProvider>
              <ClientConsoleErrorReporter />
              <ServiceWorkerRegistration />
              {children}
            </TRPCReactProvider>
          </SessionProviderWrapper>
        </ThemeProvider>
      </body>
    </html>
  );
}
