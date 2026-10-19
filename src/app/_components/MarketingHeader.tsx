"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import { APP_NAME } from "~/constants/app";

export function MarketingHeader() {
  return (
    <header className="fixed top-0 right-0 left-0 z-50 border-b border-border bg-card">
      <nav className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="text-xl font-bold text-foreground transition-colors hover:text-foreground/80 sm:text-2xl"
        >
          {APP_NAME}
        </Link>

        <div className="flex items-center gap-4">
          <Button
            asChild
            variant="outline"
            className="hidden border-primary text-primary hover:bg-primary/10 sm:inline-flex"
          >
            <Link href="/sign-in">Sign In</Link>
          </Button>
          <Button
            asChild
            className="h-10 bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus:bg-primary/90 sm:h-11 sm:px-8"
          >
            <Link href="/dashboard">Start an Order</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
