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

import { EmployeeSimulationControl } from "~/components/simulation/EmployeeSimulationControl";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { notify } from "~/components/ui/app-dialogs";
import type { PermissionKey, PermissionMap } from "~/lib/permission-catalog";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

import {
  Avatar,
  PermissionEditor,
  countAllowed,
  roleLabel,
} from "./PermissionEditor";

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

function memberRoleLabel(
  member: Member,
  presets: Settings["permissionPresets"] = [],
) {
  if (member.permissions.isAdmin) return "Admin";
  if (member.permissions.isManagingAccount) return "Executive Account";
  const preset = presets.find((p) => p.id === member.permissionPresetId);
  if (preset) return `${preset.name} · Live`;
  return roleLabel(member.permissions.can);
}

export function MembersSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => Promise<void>;
}) {
  const members = settings.members;
  const presets = useMemo(
    () => settings.permissionPresets ?? [],
    [settings.permissionPresets],
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => filter === "all" || m.organizationAccessStatus === filter)
      .filter(
        (m) =>
          !q ||
          displayName(m).toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          memberRoleLabel(m, presets).toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // People waiting for approval first, then alphabetical.
        const w = (m: Member) =>
          m.organizationAccessStatus === "pending" ? 0 : 1;
        return w(a) - w(b) || displayName(a).localeCompare(displayName(b));
      });
  }, [members, presets, query, filter]);

  // Keep a valid selection on wide screens.
  useEffect(() => {
    if (!selectedId || !members.some((m) => m.id === selectedId))
      setSelectedId(filtered[0]?.id ?? members[0]?.id ?? null);
  }, [filtered, members, selectedId]);

  const selected = members.find((m) => m.id === selectedId) ?? null;
  const pendingCount = members.filter(
    (m) => m.organizationAccessStatus === "pending",
  ).length;

  return (
    <div className="bg-card grid rounded-2xl border shadow-sm lg:grid-cols-[22rem_minmax(0,1fr)]">
      {/* Member list */}
      <aside
        className={cn(
          "flex min-h-0 flex-col border-b lg:border-r lg:border-b-0",
          mobileDetail && "hidden lg:flex",
        )}
      >
        <div className="space-y-3 border-b p-4">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or role"
              className="pl-9"
              aria-label="Search members"
            />
          </div>
          <div className="bg-muted flex gap-1 rounded-lg p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  filter === f.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                {f.id === "pending" && pendingCount > 0 && (
                  <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-white">
                    {pendingCount}
                  </span>
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
                    active
                      ? "border-l-primary bg-primary/5"
                      : "hover:bg-accent border-l-transparent",
                  )}
                >
                  <Avatar name={displayName(m)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {displayName(m)}
                      </span>
                      {m.id === settings.viewer.userId && (
                        <span className="text-muted-foreground text-xs">
                          (you)
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {m.email}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="bg-muted rounded-full px-2 py-0.5 text-[11px] font-medium">
                        {memberRoleLabel(m, presets)}
                      </span>
                      {status !== "approved" && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                            STATUS_STYLE[status],
                          )}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="text-muted-foreground shrink-0 text-xs tabular-nums"
                    title="Permissions allowed"
                  >
                    {allowed}/{total}
                  </span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-sm">
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
            presets={presets}
            isSelf={selected.id === settings.viewer.userId}
            canManage={settings.viewer.canManageMembers}
            canSimulate={
              settings.viewer.canSimulateEmployees &&
              (!selected.permissions.isAdmin ||
                settings.viewer.canSimulateAdmins)
            }
            onBack={() => setMobileDetail(false)}
            onSaved={onSaved}
          />
        ) : (
          <div className="text-muted-foreground flex h-full min-h-64 items-center justify-center p-8 text-sm">
            Select a member.
          </div>
        )}
      </div>
    </div>
  );
}

function MemberDetail({
  member,
  presets,
  isSelf,
  canManage,
  canSimulate,
  onBack,
  onSaved,
}: {
  member: Member;
  presets: Settings["permissionPresets"];
  isSelf: boolean;
  canManage: boolean;
  canSimulate: boolean;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const original = member.permissions.can;
  const originalStatus = member.organizationAccessStatus as AccessStatus;
  const [perms, setPerms] = useState<PermissionMap>(original);
  const [status, setStatus] = useState<AccessStatus>(originalStatus);
  const [presetId, setPresetId] = useState<string | null>(
    member.permissionPresetId ?? null,
  );
  const [baseline, setBaseline] = useState({
    original,
    originalStatus,
    presetId: member.permissionPresetId ?? null,
  });
  // Refresh clean drafts while preserving edits when server settings change.
  if (
    baseline.original !== original ||
    baseline.originalStatus !== originalStatus ||
    baseline.presetId !== (member.permissionPresetId ?? null)
  ) {
    const dirty =
      status !== baseline.originalStatus ||
      presetId !== baseline.presetId ||
      (Object.keys(perms) as PermissionKey[]).some(
        (key) => perms[key] !== baseline.original[key],
      );
    if (!dirty) {
      setPerms(original);
      setStatus(originalStatus);
      setPresetId(member.permissionPresetId ?? null);
    }
    setBaseline({
      original,
      originalStatus,
      presetId: member.permissionPresetId ?? null,
    });
  }
  const selectedPreset = presets.find((preset) => preset.id === presetId);
  const displayedPerms = selectedPreset?.permissions ?? perms;
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
  const accessReadOnly =
    !canManage || (hasProtectedAccess && originalStatus === "approved");
  const lockedKeys: PermissionKey[] = isSelf
    ? ["org.members", "tab.organization"]
    : [];
  const changed =
    status !== originalStatus ||
    presetId !== (member.permissionPresetId ?? null) ||
    (!presetId &&
      (Object.keys(perms) as PermissionKey[]).some(
        (k) => perms[k] !== original[k],
      ));
  const { allowed, total } = countAllowed(displayedPerms);

  return (
    <div className="flex h-full flex-col">
      <header className="from-primary/5 border-b bg-gradient-to-b to-transparent p-5">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm lg:hidden"
        >
          <ArrowLeftIcon className="h-4 w-4" /> All members
        </button>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={displayName(member)} size="lg" />
          <div className="min-w-[12rem] flex-1">
            <h2 className="truncate text-xl font-bold">
              {displayName(member)}{" "}
              {isSelf && (
                <span className="text-muted-foreground text-base font-normal">
                  (you)
                </span>
              )}
            </h2>
            <p className="text-muted-foreground truncate text-sm">
              {member.email}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {member.permissions.accountTypeLabel} · joined{" "}
              {new Date(member.createdAt).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}{" "}
              · {allowed} of {total} permissions
            </p>
          </div>
          <div
            className="bg-background flex w-full rounded-lg border p-1 sm:w-auto"
            role="radiogroup"
            aria-label="Access"
          >
            {(["approved", "pending", "denied"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                disabled={
                  accessReadOnly ||
                  update.isPending ||
                  (isSelf && s !== "approved")
                }
                onClick={() => setStatus(s)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none",
                  status === s
                    ? STATUS_STYLE[s]
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "approved"
                  ? "Active"
                  : s === "pending"
                    ? "Waiting"
                    : "Blocked"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 space-y-4 p-5">
        {hasProtectedAccess && (
          <div className="border-primary/30 bg-primary/5 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <ShieldCheckIcon className="text-primary h-4 w-4 shrink-0" />
            <span>
              {isAdmin ? "Admins" : "Executive Accounts"} always have every
              permission.
              {originalStatus === "approved"
                ? " Their access cannot be disabled."
                : " Organization membership must still be approved."}
            </span>
          </div>
        )}
        {!canManage && !hasProtectedAccess && (
          <div className="bg-muted/50 text-muted-foreground rounded-lg border px-3 py-2 text-sm">
            You can view permissions but not change them.
          </div>
        )}
        {status === "denied" && !hasProtectedAccess && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            Blocked members can't open ForemanHQ for this company, whatever
            their permissions say.
          </div>
        )}
        {!hasProtectedAccess && (
          <div className="bg-muted/30 space-y-2 rounded-xl border p-4">
            <label
              htmlFor={`preset-${member.id}`}
              className="text-sm font-semibold"
            >
              Permission preset
            </label>
            <select
              id={`preset-${member.id}`}
              className="bg-background flex h-10 w-full rounded-md border px-3 text-sm"
              value={presetId ?? ""}
              disabled={!canManage || update.isPending}
              onChange={(event) => {
                const next = event.target.value || null;
                setPerms(displayedPerms);
                setPresetId(next);
              }}
            >
              <option value="">Individual permissions</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} (live)
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              {selectedPreset
                ? `Changes saved to ${selectedPreset.name} apply automatically to this member. Edit it in Presets, or choose Individual permissions to customize this person.`
                : "Choose a live preset to keep this member’s permissions linked. Create and edit them in Presets."}
            </p>
          </div>
        )}
        <PermissionEditor
          value={displayedPerms}
          onChange={setPerms}
          disabled={readOnly || !!presetId || update.isPending}
          showPresets={!presetId}
          lockedKeys={lockedKeys}
        />
        {update.error && (
          <p className="text-destructive text-sm">{update.error.message}</p>
        )}
      </div>

      {canSimulate && !isSelf && (
        <EmployeeSimulationControl
          employeeId={member.id}
          name={displayName(member)}
          disabled={
            originalStatus !== "approved" || changed || update.isPending
          }
          disabledReason={
            changed || update.isPending
              ? "Save permission changes before starting simulation."
              : undefined
          }
        />
      )}
      {!accessReadOnly && (
        <footer
          className={cn(
            "bg-card/95 sticky bottom-0 z-10 flex items-center justify-between gap-3 rounded-b-2xl border-t px-5 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur transition-opacity",
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
                setPresetId(member.permissionPresetId ?? null);
              }}
              disabled={update.isPending}
            >
              Discard
            </Button>
            <Button
              onClick={() =>
                update.mutate({
                  userId: member.id,
                  accessStatus: status,
                  permissions: displayedPerms,
                  ...(!hasProtectedAccess
                    ? { permissionPresetId: presetId }
                    : {}),
                })
              }
              disabled={update.isPending}
            >
              {update.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <CheckIcon className="h-4 w-4" />
              )}
              Save changes
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
