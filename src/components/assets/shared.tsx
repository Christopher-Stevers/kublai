"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BriefcaseIcon,
  TruckIcon,
  UserIcon,
  WarehouseIcon,
  WifiOffIcon,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

export type HolderRef = { type: "location" | "job" | "user"; id: string };
export type Holders = RouterOutputs["assets"]["holders"];

const SECTIONS = [
  { href: "/dashboard/assets", label: "Overview", exact: true },
  { href: "/dashboard/assets/tools", label: "Tools" },
  { href: "/dashboard/assets/requests", label: "Requests" },
  { href: "/dashboard/assets/where", label: "Where" },
  { href: "/dashboard/assets/counts", label: "Counts" },
  { href: "/dashboard/assets/activity", label: "Activity" },
  { href: "/dashboard/assets/types", label: "Tool Types" },
];

/** Sub-navigation shared by every Asset Management screen. */
export function AssetsNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Asset Management">
      {SECTIONS.map((section) => {
        const active = section.exact
          ? pathname === section.href
          : pathname.startsWith(section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Page frame with the Asset Management sub-navigation. */
export function AssetsShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const isOnline = useOnlineStatus();
  return (
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <AssetsNav />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold sm:text-2xl">{title}</h2>
            {description && (
              <p className="text-muted-foreground mt-1 text-sm sm:text-base">{description}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {!isOnline ? (
          <p className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
            <WifiOffIcon className="h-3 w-3" /> Reconnect to use Asset Management.
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function useIsOnline() {
  return useOnlineStatus();
}

/** Whether the signed-in user is in the tool room (manages tools). */
export function useToolRoom() {
  const isOnline = useOnlineStatus();
  const { data } = api.assets.overview.useQuery(undefined, { enabled: isOnline });
  return { canManage: data?.canManageAssets ?? false, isSetUp: data?.isSetUp ?? true };
}

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  available: { label: "Available", className: "border-transparent bg-emerald-100 text-emerald-900" },
  in_use: { label: "In use", className: "border-transparent bg-sky-100 text-sky-900" },
  damaged: { label: "Damaged", className: "border-transparent bg-amber-100 text-amber-900" },
  missing: { label: "Missing", className: "border-transparent bg-red-100 text-red-900" },
  retired: { label: "Retired", className: "border-transparent bg-muted text-muted-foreground" },
};

export function ToolStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={style.className}>
      {style.label}
    </Badge>
  );
}

const REQUEST_STATUS: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "border-transparent bg-sky-100 text-sky-900" },
  partial: { label: "Partly filled", className: "border-transparent bg-amber-100 text-amber-900" },
  fulfilled: { label: "Done", className: "border-transparent bg-emerald-100 text-emerald-900" },
  cancelled: { label: "Closed", className: "border-transparent bg-muted text-muted-foreground" },
};

export function RequestStatusBadge({ status, kind }: { status: string | null; kind?: string }) {
  const style = REQUEST_STATUS[status ?? "open"] ?? REQUEST_STATUS.open!;
  const label = kind === "tool_return" && status === "fulfilled" ? "Received" : style.label;
  return (
    <Badge variant="outline" className={style.className}>
      {label}
    </Badge>
  );
}

export function HolderIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon =
    kind === "vehicle" ? TruckIcon : kind === "job" ? BriefcaseIcon : kind === "user" || kind === "person" ? UserIcon : WarehouseIcon;
  return <Icon className={cn("h-4 w-4 shrink-0", className)} />;
}

export function holderHref(holder: HolderRef) {
  return `/dashboard/assets/where/${holder.type}/${holder.id}`;
}

export function HolderLink({
  holder,
  label,
  kind,
}: {
  holder: HolderRef;
  label: string;
  kind: string;
}) {
  return (
    <Link
      href={holderHref(holder)}
      className="inline-flex min-w-0 items-center gap-1.5 hover:underline"
      onClick={(event) => event.stopPropagation()}
    >
      <HolderIcon kind={kind} className="text-muted-foreground" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** Holder name with its icon, for use inside another link. */
export function HolderLabel({ label, kind }: { label: string; kind: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <HolderIcon kind={kind} className="text-muted-foreground" />
      <span className="truncate">{label}</span>
    </span>
  );
}

export const selectClass =
  "border-input bg-background h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none";

/**
 * Picks where tools go. `allow` limits the kinds offered (e.g. field users
 * can only move tools between jobs and people).
 */
export function HolderSelect({
  holders,
  value,
  onChange,
  allow = ["location", "job", "user"],
  exclude,
  placeholder = "Choose where…",
  id,
}: {
  holders: Holders | undefined;
  value: HolderRef | null;
  onChange: (holder: HolderRef | null) => void;
  allow?: HolderRef["type"][];
  exclude?: HolderRef | null;
  placeholder?: string;
  id?: string;
}) {
  const key = value ? `${value.type}:${value.id}` : "";
  const skip = exclude ? `${exclude.type}:${exclude.id}` : null;
  const locations = (holders?.locations ?? []).filter((l) => l.isActive);
  return (
    <select
      id={id}
      className={selectClass}
      value={key}
      onChange={(event) => {
        const [type, ...rest] = event.target.value.split(":");
        onChange(type ? { type: type as HolderRef["type"], id: rest.join(":") } : null);
      }}
    >
      <option value="">{placeholder}</option>
      {allow.includes("location") && locations.length > 0 && (
        <optgroup label="Yard, warehouses & vehicles">
          {locations
            .filter((l) => `location:${l.id}` !== skip)
            .map((l) => (
              <option key={l.id} value={`location:${l.id}`}>
                {l.name}
                {l.kind === "vehicle" ? " (vehicle)" : ""}
              </option>
            ))}
        </optgroup>
      )}
      {allow.includes("job") && (
        <optgroup label="Jobs">
          {(holders?.jobs ?? [])
            .filter((j) => `job:${j.id}` !== skip)
            .map((j) => (
              <option key={j.id} value={`job:${j.id}`}>
                {j.name}
              </option>
            ))}
        </optgroup>
      )}
      {allow.includes("user") && (
        <optgroup label="People">
          {(holders?.people ?? [])
            .filter((p) => `user:${p.id}` !== skip)
            .map((p) => (
              <option key={p.id} value={`user:${p.id}`}>
                {p.id === holders?.me ? `${p.name} (me)` : p.name}
              </option>
            ))}
        </optgroup>
      )}
    </select>
  );
}

export function formatQty(value: number) {
  return value.toLocaleString("en-CA", { maximumFractionDigits: 3 });
}

export function formatWhen(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

const MOVEMENT_LABEL: Record<string, string> = {
  receive: "Received",
  checkout: "Checked out",
  return: "Returned",
  transfer: "Moved",
  adjust: "Adjusted",
  status: "Status",
  count: "Count",
};

/** One line describing a movement, for history and activity feeds. */
export function describeMovement(m: {
  kind: string;
  from: string | null;
  to: string | null;
  statusTo?: string | null;
  quantity?: number;
}) {
  const label = MOVEMENT_LABEL[m.kind] ?? m.kind;
  const qty = m.quantity !== undefined && m.quantity !== 1 ? ` ${formatQty(m.quantity)}` : "";
  // Status changes are recorded in place (from and to are the same holder).
  if (m.statusTo && (m.kind === "status" || (m.from && m.from === m.to))) {
    const status = STATUS_STYLE[m.statusTo]?.label.toLowerCase() ?? m.statusTo;
    return m.kind === "count" ? `Count: marked ${status}` : `Marked ${status}`;
  }
  // Adjustments and counts correct a quantity at one place.
  const correction = m.kind === "adjust" || m.kind === "count";
  if (m.from && m.to) return `${label}${qty}: ${m.from} → ${m.to}`;
  if (m.to) return correction ? `${label}: +${formatQty(m.quantity ?? 1)} at ${m.to}` : `${label}${qty} into ${m.to}`;
  if (m.from) return correction ? `${label}: −${formatQty(m.quantity ?? 1)} at ${m.from}` : `${label}${qty} out of ${m.from}`;
  return label;
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <div className="text-muted-foreground mx-auto flex justify-center [&>svg]:h-10 [&>svg]:w-10">{icon}</div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      {children && <div className="text-muted-foreground mt-1 text-sm">{children}</div>}
    </div>
  );
}

export function ErrorText({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="text-destructive text-sm">{message}</p>;
}
