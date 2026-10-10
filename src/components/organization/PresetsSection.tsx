"use client";

import { useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  Loader2Icon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import {
  STANDARD_DEFAULTS,
  PERMISSION_KEYS,
  type PermissionMap,
} from "~/lib/permission-catalog";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";
import { PermissionEditor, countAllowed } from "./PermissionEditor";

type Settings = RouterOutputs["organization"]["getOrganizationSettings"];
type Preset = Settings["permissionPresets"][number];

export function PresetsSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => Promise<void>;
}) {
  const presets = settings.permissionPresets;
  const canManage = settings.viewer.canManageMembers;
  const [selectedId, setSelectedId] = useState<string | null>(
    presets[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const selected = presets.find((preset) => preset.id === selectedId);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Create a preset such as Journeyman, then assign it in Members. Every
        saved change applies to everyone using that preset.
      </p>
      <div className="bg-card grid rounded-2xl border shadow-sm lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside
          className={cn(
            "border-b lg:border-r lg:border-b-0",
            mobileDetail && "hidden lg:block",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <h2 className="font-semibold">Permission presets</h2>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setCreating(true);
                  setMobileDetail(true);
                }}
              >
                <PlusIcon className="h-4 w-4" /> New preset
              </Button>
            )}
          </div>
          <ul className="divide-y">
            {presets.map((preset) => {
              const count = countAllowed(preset.permissions);
              return (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(preset.id);
                      setCreating(false);
                      setMobileDetail(true);
                    }}
                    className={cn(
                      "hover:bg-accent flex w-full items-center gap-3 border-l-4 p-4 text-left",
                      !creating && selectedId === preset.id
                        ? "border-l-primary bg-primary/5"
                        : "border-l-transparent",
                    )}
                  >
                    <ShieldCheckIcon className="text-primary h-5 w-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {preset.name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {preset.memberCount} member
                        {preset.memberCount === 1 ? "" : "s"} · {count.allowed}/
                        {count.total} permissions
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                      Live
                    </span>
                  </button>
                </li>
              );
            })}
            {!presets.length && (
              <li className="text-muted-foreground px-4 py-8 text-sm">
                No saved presets yet. Create one using a quick setup template or
                your own permissions.
              </li>
            )}
          </ul>
        </aside>
        <div className={cn("min-w-0", !mobileDetail && "hidden lg:block")}>
          {creating || selected ? (
            <PresetDetail
              key={creating ? "new" : selected!.id}
              preset={creating ? undefined : selected}
              settings={settings}
              onBack={() => setMobileDetail(false)}
              onSaved={async (id) => {
                await onSaved();
                setSelectedId(id);
                setCreating(false);
              }}
              onDeleted={async () => {
                await onSaved();
                setSelectedId(null);
                setCreating(false);
                setMobileDetail(false);
              }}
            />
          ) : (
            <div className="text-muted-foreground flex min-h-64 items-center justify-center p-8 text-sm">
              Select a preset or create one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PresetDetail({
  preset,
  settings,
  onBack,
  onSaved,
  onDeleted,
}: {
  preset?: Preset;
  settings: Settings;
  onBack: () => void;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(preset?.name ?? "");
  const [permissions, setPermissions] = useState<PermissionMap>(
    preset?.permissions ?? { ...STANDARD_DEFAULTS },
  );
  const [applyDetails, setApplyDetails] = useState(
    !preset || !!preset.memberDetails,
  );
  const [baselineApplyDetails, setBaselineApplyDetails] =
    useState(applyDetails);
  const [department, setDepartment] = useState(
    preset?.memberDetails?.department ?? "",
  );
  const [reportsToUserIds, setReportsToUserIds] = useState<string[]>(
    preset?.memberDetails?.reportsToUserIds ?? [],
  );
  const detailsKey = JSON.stringify([department, [...reportsToUserIds].sort()]);
  const [baselineDetailsKey, setBaselineDetailsKey] = useState(detailsKey);
  const [reportsQuery, setReportsQuery] = useState("");
  const [revision, setRevision] = useState(preset?.revision);
  const [baseline, setBaseline] = useState({ name, permissions });
  const [loadedPreset, setLoadedPreset] = useState(preset);
  // Refresh a clean editor when another manager changes the live preset; keep
  // dirty edits and their revision so stale saves receive a conflict.
  if (preset && loadedPreset !== preset) {
    const before = baseline;
    const dirty =
      applyDetails !== baselineApplyDetails ||
      detailsKey !== baselineDetailsKey ||
      name !== before.name ||
      PERMISSION_KEYS.some(
        (key) => permissions[key] !== before.permissions[key],
      );
    if (!dirty) {
      setApplyDetails(!!preset.memberDetails);
      setBaselineApplyDetails(!!preset.memberDetails);
      setDepartment(preset.memberDetails?.department ?? "");
      setReportsToUserIds(preset.memberDetails?.reportsToUserIds ?? []);
      setBaselineDetailsKey(
        JSON.stringify([
          preset.memberDetails?.department ?? "",
          [...(preset.memberDetails?.reportsToUserIds ?? [])].sort(),
        ]),
      );
      setName(preset.name);
      setPermissions(preset.permissions);
      setRevision(preset.revision);
      setBaseline({ name: preset.name, permissions: preset.permissions });
    }
    setLoadedPreset(preset);
  }
  const save = api.organization.savePermissionPreset.useMutation({
    onError: async (error) => {
      if (preset && error.data?.code === "CONFLICT") await onSaved(preset.id);
    },
    onSuccess: async (saved) => {
      setBaselineApplyDetails(applyDetails);
      setBaselineDetailsKey(detailsKey);
      setBaseline({ name: name.trim(), permissions });
      setName(name.trim());
      setRevision(saved.revision);
      await onSaved(saved.id);
      notify(
        `Saved ${name.trim()}. Everyone using this preset now has its permissions, department and reporting assignments.`,
        "success",
      );
    },
  });
  const remove = api.organization.deletePermissionPreset.useMutation({
    onSuccess: async () => {
      await onDeleted();
      notify("Preset deleted.", "success");
    },
  });
  const pending = save.isPending || remove.isPending;
  const readOnly = !settings.viewer.canManageMembers || pending;
  const changed =
    !preset ||
    applyDetails !== baselineApplyDetails ||
    detailsKey !== baselineDetailsKey ||
    name !== baseline.name ||
    PERMISSION_KEYS.some(
      (key) => permissions[key] !== baseline.permissions[key],
    );
  const assigned = preset
    ? settings.members.filter(
        (member) => member.permissionPresetId === preset.id,
      )
    : [];
  const selfAssigned = assigned.some(
    (member) =>
      member.id === settings.viewer.userId &&
      !member.permissions.isManagingAccount,
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && changed && name.trim())
          save.mutate({
            id: preset?.id,
            revision,
            name,
            permissions,
            memberDetails: applyDetails
              ? {
                  department: department.trim() || null,
                  reportsToUserIds,
                }
              : undefined,
          });
      }}
    >
      <header className="space-y-4 border-b p-5">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground inline-flex items-center gap-1 text-sm lg:hidden"
        >
          <ArrowLeftIcon className="h-4 w-4" /> All presets
        </button>
        <h2 className="text-xl font-bold">
          {preset ? "Edit preset" : "New permission preset"}
        </h2>
        <div className="space-y-2">
          <label
            htmlFor="permission-preset-name"
            className="text-sm font-medium"
          >
            Preset name
          </label>
          <Input
            id="permission-preset-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Journeyman"
            maxLength={100}
            required
            disabled={readOnly}
          />
        </div>
        <div className="border-primary/20 bg-primary/5 rounded-lg border p-3 text-sm">
          {assigned.length ? (
            <>
              <strong>
                {assigned.length} member{assigned.length === 1 ? "" : "s"} will
                update when you save.
              </strong>
              <p className="text-muted-foreground mt-1 text-xs break-words">
                {assigned
                  .map((member) =>
                    member.name?.trim() ? member.name : member.email,
                  )
                  .join(", ")}
              </p>
            </>
          ) : (
            "Choose permissions below. After saving, assign this live preset to people in Members."
          )}
        </div>
      </header>
      <div className="space-y-4 p-5">
        <section
          aria-label="Preset department and reporting"
          className="space-y-4 rounded-xl border p-4"
        >
          {preset && !preset.memberDetails && (
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={applyDetails}
                disabled={readOnly}
                onChange={(event) => setApplyDetails(event.target.checked)}
              />
              Include department and reporting in this preset
            </label>
          )}
          <div className="space-y-2">
            <label
              htmlFor="preset-department"
              className="text-sm font-semibold"
            >
              Department
            </label>
            <Input
              id="preset-department"
              list="preset-departments"
              value={department}
              maxLength={100}
              disabled={readOnly || !applyDetails}
              placeholder="Choose or enter a department"
              onChange={(event) => setDepartment(event.target.value)}
            />
            <datalist id="preset-departments">
              {[
                ...new Set(
                  settings.members
                    .map((member) => member.department)
                    .filter(Boolean),
                ),
              ].map((value) => (
                <option key={value} value={value!} />
              ))}
            </datalist>
          </div>
          <fieldset disabled={readOnly || !applyDetails} className="space-y-2">
            <legend className="text-sm font-semibold">Reports to</legend>
            <Input
              value={reportsQuery}
              onChange={(event) => setReportsQuery(event.target.value)}
              aria-label="Search preset reporting managers"
              placeholder="Search people…"
            />
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
              {settings.members
                .filter((member) =>
                  `${member.name ?? ""} ${member.email} ${member.department ?? ""}`
                    .toLowerCase()
                    .includes(reportsQuery.toLowerCase()),
                )
                .map((member) => (
                  <label
                    key={member.id}
                    className="hover:bg-accent flex items-center gap-3 rounded-md p-2"
                  >
                    <input
                      type="checkbox"
                      className="accent-primary h-4 w-4"
                      checked={reportsToUserIds.includes(member.id)}
                      onChange={(event) =>
                        setReportsToUserIds((current) =>
                          event.target.checked
                            ? [...current, member.id]
                            : current.filter((id) => id !== member.id),
                        )
                      }
                    />
                    <span className="text-sm">
                      {member.name?.trim() || member.email}
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
          <p className="text-muted-foreground text-xs">
            These choices apply to everyone using this preset. A blank
            department means no department; no checked people means no reporting
            manager.
          </p>
          {preset && !preset.memberDetails && (
            <p className="text-muted-foreground text-xs">
              Existing member assignments stay unchanged until you include
              department and reporting in this preset.
            </p>
          )}
        </section>
        <PermissionEditor
          value={permissions}
          onChange={setPermissions}
          disabled={readOnly}
          lockedKeys={selfAssigned ? ["org.members", "tab.organization"] : []}
        />
        {(save.error ?? remove.error) && (
          <p role="alert" className="text-destructive text-sm">
            {save.error?.message ?? remove.error?.message}
          </p>
        )}
        {save.error?.data?.code === "CONFLICT" && preset && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setApplyDetails(!!preset.memberDetails);
              setBaselineApplyDetails(!!preset.memberDetails);
              setDepartment(preset.memberDetails?.department ?? "");
              setReportsToUserIds(preset.memberDetails?.reportsToUserIds ?? []);
              setBaselineDetailsKey(
                JSON.stringify([
                  preset.memberDetails?.department ?? "",
                  [...(preset.memberDetails?.reportsToUserIds ?? [])].sort(),
                ]),
              );
              setName(preset.name);
              setPermissions(preset.permissions);
              setRevision(preset.revision);
              setBaseline({
                name: preset.name,
                permissions: preset.permissions,
              });
              save.reset();
            }}
          >
            Reload saved preset
          </Button>
        )}
      </div>
      {settings.viewer.canManageMembers && (
        <footer className="bg-card/95 sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t px-5 py-3 backdrop-blur">
          {preset ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending || assigned.length > 0}
              title={
                assigned.length
                  ? "Reassign members before deleting this preset."
                  : undefined
              }
              onClick={async () => {
                if (
                  await confirmAction({
                    title: `Delete ${preset.name}?`,
                    description: "This preset has no assigned members.",
                    confirmLabel: "Delete preset",
                    destructive: true,
                  })
                )
                  remove.mutate({ id: preset.id });
              }}
            >
              <Trash2Icon className="h-4 w-4" /> Delete preset
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">
              Assign members after saving.
            </span>
          )}
          <Button type="submit" disabled={pending || !changed || !name.trim()}>
            {pending ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <CheckIcon className="h-4 w-4" />
            )}{" "}
            Save preset
          </Button>
        </footer>
      )}
    </form>
  );
}
