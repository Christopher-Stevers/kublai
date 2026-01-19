"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { UserIcon, ChevronDownIcon, MenuIcon, XIcon } from "lucide-react";
import { APP_NAME } from "~/constants/app";

export function Header() {
  const pathname = usePathname();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: userRole } = api.user.getMyRole.useQuery(undefined, {
    enabled: !!user,
  });

  const navLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/dashboard/catalogue", label: "Catalogue" },
    { href: "/dashboard/suppliers", label: "Suppliers" },
    { href: "/dashboard/quotes", label: "Quotes" },
    { href: "/dashboard/orders", label: "Orders" },
    ...(userRole?.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      // Active for /dashboard and /dashboard/jobs/* but not /dashboard/material-lists/*
      return (
        pathname === "/dashboard" ||
        (pathname?.startsWith("/dashboard/jobs/") ?? false)
      );
    }
    return pathname?.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center gap-4 sm:gap-8">
        <Link
          href="/dashboard"
          className="text-lg font-bold text-gray-900 sm:text-xl"
        >
          {APP_NAME}
        </Link>
        {/* Desktop Navigation */}
        <nav className="hidden gap-6 lg:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors ${
                isActive(link.href)
                  ? "text-gray-900 underline"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Desktop Actions */}
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
                  {user?.primaryEmailAddress?.emailAddress ?? "Not signed in"}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/account">Manage Account</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void signOut();
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile Menu Button */}
      <div className="flex items-center gap-2 lg:hidden">
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

      {/* Mobile Menu Overlay */}
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
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`block rounded-md px-3 py-3 text-base font-medium transition-colors ${
                        isActive(link.href)
                          ? "bg-gray-100 text-gray-900"
                          : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </nav>
              <div className="border-t px-4 py-4">
                <div className="mb-3 flex items-center gap-3 rounded-md px-3 py-2">
                  <UserIcon className="text-muted-foreground h-5 w-5" />
                  <span className="truncate text-sm text-gray-700">
                    {user?.primaryEmailAddress?.emailAddress ?? "Not signed in"}
                  </span>
                </div>
                <div className="space-y-1">
                  <Link
                    href="/dashboard/account"
                    onClick={() => setMobileMenuOpen(false)}
                    className="block rounded-md px-3 py-2 text-base font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
                  >
                    Manage Account
                  </Link>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false);
                      void signOut();
                    }}
                    className="block w-full rounded-md px-3 py-2 text-left text-base font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
