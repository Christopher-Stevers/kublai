import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist } from "next/font/google";

import { SessionProviderWrapper } from "./_components/SessionProviderWrapper";
import { TRPCReactProvider } from "~/trpc/react";
import { APP_NAME } from "~/constants/app";

export const metadata: Metadata = {
  title: `${APP_NAME} - Mobile Digital Advertising on Trade Trucks`,
  description:
    "Reach your target audience with mobile digital advertising boards on trade trucks, tow trucks, and service trucks. Book your campaign today and maximize visibility in high-traffic areas.",
  keywords: [
    "mobile advertising",
    "digital billboard",
    "trade truck advertising",
    "tow truck advertising",
    "service truck advertising",
    "mobile marketing",
    "outdoor advertising",
  ],
  icons: [{ rel: "icon", url: "/favicon.ico" }],
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
