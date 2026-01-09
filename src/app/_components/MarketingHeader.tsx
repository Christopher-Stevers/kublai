"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import { APP_NAME } from "~/constants/app";

export function MarketingHeader() {
  return (
    <header className="fixed top-0 right-0 left-0 z-50 border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="text-xl font-bold text-gray-900 transition-colors hover:text-gray-700 sm:text-2xl"
        >
          {APP_NAME}
        </Link>

        <div className="flex items-center gap-4">
          <Button
            asChild
            variant="outline"
            className="hidden border-blue-600 text-blue-600 hover:bg-blue-50 sm:inline-flex"
          >
            <Link href="/api/auth/signin">Sign In</Link>
          </Button>
          <Button
            asChild
            className="h-10 bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700 focus:bg-blue-700 sm:h-11 sm:px-8"
          >
            <Link href="/dashboard">Start an Order</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
