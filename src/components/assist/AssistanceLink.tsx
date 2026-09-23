"use client";
import Link from "next/link";
import type { AssistanceMode } from "~/server/assist/decisions";
import { Sparkles } from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";
export function AssistanceLink({
  mode = "search",
  id,
  children = "AI assistance",
}: {
  mode?: AssistanceMode;
  id?: string;
  children?: React.ReactNode;
}) {
  const online = useOnlineStatus();
  if (!online) return null;
  const query = new URLSearchParams({ mode });
  if (id) query.set("id", id);
  return (
    <Link
      href={`/dashboard/assist?${query}`}
      className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100"
    >
      <Sparkles className="h-4 w-4" />
      {children}
    </Link>
  );
}
