"use client";

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
import { UserIcon, ChevronDownIcon } from "lucide-react";
import { APP_NAME } from "~/constants/app";

export function Header() {
  const pathname = usePathname();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: userRole } = api.user.getMyRole.useQuery(undefined, {
    enabled: !!user,
  });

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
      <div className="flex items-center gap-8">
        <Link href="/dashboard" className="text-xl font-bold text-gray-900">
          {APP_NAME}
        </Link>
        <nav className="flex gap-6">
          <Link
            href="/dashboard"
            className={`text-sm font-medium transition-colors ${
              pathname === "/dashboard"
                ? "text-gray-900 underline"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Dashboard
          </Link>
          <Link
            href="/dashboard/material-lists"
            className={`text-sm font-medium transition-colors ${
              pathname?.startsWith("/dashboard/material-lists")
                ? "text-gray-900 underline"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Material Lists
          </Link>
          <Link
            href="/dashboard/catalogue"
            className={`text-sm font-medium transition-colors ${
              pathname === "/dashboard/catalogue"
                ? "text-gray-900 underline"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Catalogue
          </Link>
          <Link
            href="/dashboard/suppliers"
            className={`text-sm font-medium transition-colors ${
              pathname === "/dashboard/suppliers"
                ? "text-gray-900 underline"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Suppliers
          </Link>
          <Link
            href="/dashboard/parts"
            className={`text-sm font-medium transition-colors ${
              pathname === "/dashboard/parts"
                ? "text-gray-900 underline"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Parts
          </Link>
          {userRole?.role === "admin" && (
            <Link
              href="/admin"
              className={`text-sm font-medium transition-colors ${
                pathname === "/admin"
                  ? "text-gray-900 underline"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Admin
            </Link>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2">
              <UserIcon className="h-5 w-5" />
              <ChevronDownIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex items-center gap-3">
                <UserIcon className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-gray-700 truncate">
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
    </header>
  );
}
