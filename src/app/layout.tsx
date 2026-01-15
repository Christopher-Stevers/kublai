import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { SessionProviderWrapper } from "./_components/SessionProviderWrapper";
import { TRPCReactProvider } from "~/trpc/react";
import { APP_NAME } from "~/constants/app";

export const metadata: Metadata = {
  title: `${APP_NAME} - Simplified Parts Ordering for Trades Foremen`,
  description:
    "ForemanHQ helps trades foremen quickly and easily order parts and supplies for their job sites. Streamline your workflow, reduce downtime, and manage orders all in one place.",
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
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
  },
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body>
        <SessionProviderWrapper>
          <TRPCReactProvider>{children}</TRPCReactProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
