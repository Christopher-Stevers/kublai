"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  Loader2Icon,
  SearchIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { notify } from "~/components/ui/app-dialogs";
import type { PermissionKey, PermissionMap } from "~/lib/permission-catalog";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

import { Avatar, PermissionEditor, countAllowed, roleLabel } from "./PermissionEditor";

type Settings = RouterOutputs["organization"]["getOrganizationSettings"];
type Member = Settings["members"][number];
type AccessStatus = "approved" | "pending" | "denied";

const STATUS_STYLE: Record<AccessStatus, string> = {
  approved: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-900",
  denied: "bg-rose-100 text-rose-800",
};
const STATUS_LABEL: Record<AccessStatus, string> = {
  approved: "Active",
  pending: "Waiting for approval",
  denied: "Blocked",
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Waiting" },
  { id: "approved", label: "Active" },
  { id: "denied", label: "Blocked" },
] as const;

function displayName(m: Member) {
  return m.name?.trim() || m.email;
}

function memberRoleLabel(member: Member) {
  if (member.permissions.isAdmin) return "Admin";
  if (member.permissions.isManagingAccount) return "Executive Account";
  return roleLabel(member.permissions.can);
}

export function MembersSection({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const members = settings.members;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => filter === "all" || m.organizationAccessStatus === filter)
      .filter((m) => !q || displayName(m).toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || memberRoleLabel(m).toLowerCase().includes(q))
      .sort((a, b) => {
        // People waiting for approval first, then alphabetical.
        const w = (m: Member) => (m.organizationAccessStatus === "pending" ? 0 : 1);
        return w(a) - w(b) || displayName(a).localeCompare(displayName(b));
      });
  }, [members, query, filter]);

  // Keep a valid selection on wide screens.
  useEffect(() => {
    if (!selectedId || !members.some((m) => m.id === selectedId)) setSelectedId(filtered[0]?.id ?? members[0]?.id ?? null);
  }, [filtered, members, selectedId]);

  const selected = members.find((m) => m.id === selectedId) ?? null;
  const pendingCount = members.filter((m) => m.organizationAccessStatus === "pending").length;

  return (
    <div className="grid rounded-2xl border bg-card shadow-sm lg:grid-cols-[22rem_minmax(0,1fr)]">
      {/* Member list */}
      <aside className={cn("flex min-h-0 flex-col border-b lg:border-r lg:border-b-0", mobileDetail && "hidden lg:flex")}>
        <div className="space-y-3 border-b p-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or role" className="pl-9" aria-label="Search members" />
          </div>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  filter === f.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                {f.id === "pending" && pendingCount > 0 && (
                  <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">{pendingCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <ul className="max-h-[32rem] flex-1 overflow-y-auto lg:max-h-[calc(100vh-16rem)]">
          {filtered.map((m) => {
            const status = m.organizationAccessStatus as AccessStatus;
            const { allowed, total } = countAllowed(m.permissions.can);
            const active = m.id === selectedId;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(m.id);
                    setMobileDetail(true);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 border-l-4 px-4 py-3 text-left transition-colors",
                    active ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-accent",
                  )}
                >
                  <Avatar name={displayName(m)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{displayName(m)}</span>
                      {m.id === settings.viewer.userId && <span className="text-xs text-muted-foreground">(you)</span>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                        {memberRoleLabel(m)}
                      </span>
                      {status !== "approved" && (
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title="Permissions allowed">
                    {allowed}/{total}
                  </span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
              <UsersIcon className="h-8 w-8" />
              No members match.
            </li>
          )}
        </ul>
      </aside>

      {/* Selected member */}
      <div className={cn("min-w-0", !mobileDetail && "hidden lg:block")}>
        {selected ? (
          <MemberDetail
            key={selected.id}
            member={selected}
            isSelf={selected.id === settings.viewer.userId}
            canManage={settings.viewer.canManageMembers}
            onBack={() => setMobileDetail(false)}
            onSaved={onSaved}
          />
        ) : (
          <div className="flex h-full min-h-64 items-center justify-center p-8 text-sm text-muted-foreground">Select a member.</div>
        )}
      </div>
    </div>
  );
}

function MemberDetail({
  member,
  isSelf,
  canManage,
  onBack,
  onSaved,
}: {
  member: Member;
  isSelf: boolean;
  canManage: boolean;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const original = member.permissions.can;
  const originalStatus = member.organizationAccessStatus as AccessStatus;
  const [perms, setPerms] = useState<PermissionMap>(original);
  const [status, setStatus] = useState<AccessStatus>(originalStatus);
  const update = api.organization.updateOrganizationMember.useMutation({
    onSuccess: async () => {
      await onSaved();
      notify(`Saved ${displayName(member)}.`, "success");
    },
  });
  const isAdmin = member.permissions.isAdmin;
  const isExecutive = member.permissions.isManagingAccount;
  const hasProtectedAccess = isAdmin || isExecutive;
  const readOnly = !canManage || hasProtectedAccess;
  const accessReadOnly = !canManage || (hasProtectedAccess && originalStatus === "approved");
  const lockedKeys: PermissionKey[] = isSelf ? ["org.members", "tab.organization"] : [];
  const changed = status !== originalStatus || (Object.keys(perms) as PermissionKey[]).some((k) => perms[k] !== original[k]);
  const { allowed, total } = countAllowed(perms);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-gradient-to-b from-primary/5 to-transparent p-5">
        <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden">
          <ArrowLeftIcon className="h-4 w-4" /> All members
        </button>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={displayName(member)} size="lg" />
          <div className="min-w-[12rem] flex-1">
            <h2 className="truncate text-xl font-bold">
              {displayName(member)} {isSelf && <span className="text-base font-normal text-muted-foreground">(you)</span>}
            </h2>
            <p className="truncate text-sm text-muted-foreground">{member.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {member.permissions.accountTypeLabel} · joined{" "}
              {new Date(member.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} · {allowed} of {total} permissions
            </p>
          </div>
          <div className="flex w-full rounded-lg border bg-background p-1 sm:w-auto" role="radiogroup" aria-label="Access">
            {(["approved", "pending", "denied"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                disabled={accessReadOnly || update.isPending || (isSelf && s !== "approved")}
                onClick={() => setStatus(s)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none",
                  status === s ? STATUS_STYLE[s] : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "approved" ? "Active" : s === "pending" ? "Waiting" : "Blocked"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-4 p-5">
        {hasProtectedAccess && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <ShieldCheckIcon className="h-4 w-4 shrink-0 text-primary" />
            <span>
              {isAdmin ? "Admins" : "Executive Accounts"} always have every permission.
              {originalStatus === "approved"
                ? " Their access cannot be disabled."
                : " Organization membership must still be approved."}
            </span>
          </div>
        )}
        {!canManage && !hasProtectedAccess && (
          <div className="rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">You can view permissions but not change them.</div>
        )}
        {status === "denied" && !hasProtectedAccess && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">Blocked members can't open ForemanHQ for this company, whatever their permissions say.</div>
        )}
        <PermissionEditor value={perms} onChange={setPerms} disabled={readOnly || update.isPending} lockedKeys={lockedKeys} />
        {update.error && <p className="text-sm text-destructive">{update.error.message}</p>}
      </div>

      {!accessReadOnly && (
        <footer
          className={cn(
            "sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-b-2xl border-t bg-card/95 px-5 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur transition-opacity",
            changed ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <span className="text-sm font-medium">Unsaved changes</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPerms(original);
                setStatus(originalStatus);
              }}
              disabled={update.isPending}
            >
              Discard
            </Button>
            <Button onClick={() => update.mutate({ userId: member.id, accessStatus: status, permissions: perms })} disabled={update.isPending}>
              {update.isPending ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
              Save changes
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
