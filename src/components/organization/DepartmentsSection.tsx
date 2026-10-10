"use client";

import { useState } from "react";
import {
  ArrowLeftIcon,
  Building2Icon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { confirmAction, notify } from "~/components/ui/app-dialogs";
import { cn } from "~/lib/utils";

type Settings = RouterOutputs["organization"]["getOrganizationSettings"];
type Department = Settings["departments"][number];
const personName = (person: Settings["members"][number]) =>
  person.name?.trim() || person.email;

export function DepartmentsSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => Promise<void>;
}) {
  const departments = settings.departments;
  const [selectedId, setSelectedId] = useState<string | null>(
    departments[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const selected = departments.find(
    (department) => department.id === selectedId,
  );
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Organize your company into departments and choose the people who lead
        each one. Assign members through Members or Presets.
      </p>
      <div className="bg-card grid rounded-2xl border shadow-sm lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside
          className={cn(
            "border-b lg:border-r lg:border-b-0",
            mobileDetail && "hidden lg:block",
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b p-4">
            <h2 className="font-semibold">Departments</h2>
            {settings.viewer.canManageMembers && (
              <Button
                size="sm"
                onClick={() => {
                  setCreating(true);
                  setMobileDetail(true);
                }}
              >
                <PlusIcon className="h-4 w-4" />
                New department
              </Button>
            )}
          </div>
          <ul className="divide-y">
            {departments.map((department) => (
              <li key={department.id}>
                <button
                  type="button"
                  className={cn(
                    "hover:bg-accent flex w-full items-start gap-3 border-l-4 p-4 text-left",
                    !creating && selectedId === department.id
                      ? "border-l-primary bg-primary/5"
                      : "border-l-transparent",
                  )}
                  onClick={() => {
                    setSelectedId(department.id);
                    setCreating(false);
                    setMobileDetail(true);
                  }}
                >
                  <Building2Icon className="text-primary mt-0.5 h-5 w-5 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {department.name}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {department.memberCount} member
                      {department.memberCount === 1 ? "" : "s"}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs break-words">
                      {department.leadUserIds.length
                        ? settings.members
                            .filter((member) =>
                              department.leadUserIds.includes(member.id),
                            )
                            .map(personName)
                            .join(", ")
                        : "No leads assigned"}
                    </p>
                  </div>
                </button>
              </li>
            ))}
            {!departments.length && (
              <li className="text-muted-foreground px-4 py-8 text-sm">
                No departments yet. Create your first department to get started.
              </li>
            )}
          </ul>
        </aside>
        <div className={cn("min-w-0", !mobileDetail && "hidden lg:block")}>
          {creating || selected ? (
            <DepartmentDetail
              key={creating ? "new" : selected!.id}
              department={creating ? undefined : selected}
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
            <p className="text-muted-foreground flex min-h-64 items-center justify-center p-8 text-sm">
              Select a department or create one.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DepartmentDetail({
  department,
  settings,
  onBack,
  onSaved,
  onDeleted,
}: {
  department?: Department;
  settings: Settings;
  onBack: () => void;
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(department?.name ?? "");
  const [leadIds, setLeadIds] = useState<string[]>(
    department?.leadUserIds ?? [],
  );
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState(department);
  const [revision, setRevision] = useState(department?.revision);
  const [baseline, setBaseline] = useState(
    JSON.stringify([name, [...leadIds].sort()]),
  );
  const current = JSON.stringify([name, [...leadIds].sort()]);
  const dirty = current !== baseline;
  if (department && loaded !== department) {
    if (!dirty) {
      setName(department.name);
      setLeadIds(department.leadUserIds);
      setRevision(department.revision);
      setBaseline(
        JSON.stringify([department.name, [...department.leadUserIds].sort()]),
      );
    }
    setLoaded(department);
  }
  const save = api.organization.saveDepartment.useMutation({
    onSuccess: async (saved) => {
      setName(name.trim());
      setRevision(saved.revision);
      setBaseline(JSON.stringify([name.trim(), [...leadIds].sort()]));
      await onSaved(saved.id);
      notify("Department saved.", "success");
    },
    onError: async (error) => {
      if (department && error.data?.code === "CONFLICT")
        await onSaved(department.id);
    },
  });
  const remove = api.organization.deleteDepartment.useMutation({
    onSuccess: async () => {
      await onDeleted();
      notify("Department deleted.", "success");
    },
  });
  const pending = save.isPending || remove.isPending;
  const readOnly = !settings.viewer.canManageMembers || pending;
  const members = settings.members.filter(
    (member) =>
      department &&
      member.department?.trim().toLowerCase() === department.name.toLowerCase(),
  );
  const presetCount = settings.permissionPresets.filter(
    (preset) =>
      department &&
      preset.memberDetails?.department?.trim().toLowerCase() ===
        department.name.toLowerCase(),
  ).length;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && name.trim())
          save.mutate({
            id: department?.id,
            revision,
            name,
            leadUserIds: leadIds,
          });
      }}
    >
      <header className="space-y-4 border-b p-5">
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground inline-flex items-center gap-1 text-sm lg:hidden"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          All departments
        </button>
        <h2 className="text-xl font-bold">
          {department ? "Edit department" : "New department"}
        </h2>
        <div className="space-y-2">
          <label htmlFor="department-name" className="text-sm font-medium">
            Department name
          </label>
          <Input
            id="department-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Plumbing"
            required
            maxLength={100}
            disabled={readOnly}
          />
        </div>
      </header>
      <div className="space-y-5 p-5">
        <fieldset className="space-y-3" disabled={readOnly}>
          <legend className="text-sm font-semibold">Department leads</legend>
          <p className="text-muted-foreground text-xs">
            Choose one or more people from your organization. Leads keep their
            existing account permissions and reporting assignments.
          </p>
          <Input
            aria-label="Search department leads"
            placeholder="Search people…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
            {settings.members
              .filter((member) =>
                `${personName(member)} ${member.email} ${member.department ?? ""}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((member) => (
                <label
                  key={member.id}
                  className="hover:bg-accent flex items-center gap-3 rounded-md p-2"
                >
                  <input
                    type="checkbox"
                    className="accent-primary h-4 w-4 shrink-0"
                    checked={leadIds.includes(member.id)}
                    onChange={(event) =>
                      setLeadIds((current) =>
                        event.target.checked
                          ? [...current, member.id]
                          : current.filter((id) => id !== member.id),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {personName(member)}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {member.department ? `${member.department} · ` : ""}
                      {member.email}
                    </span>
                  </span>
                </label>
              ))}
            {!settings.members.some((member) =>
              `${personName(member)} ${member.email} ${member.department ?? ""}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ) && (
              <p className="text-muted-foreground p-2 text-sm">
                No people match.
              </p>
            )}
          </div>
        </fieldset>
        {department && (
          <section className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold">
              Members · {members.length}
            </h3>
            <p className="text-muted-foreground mt-2 text-sm break-words">
              {members.length
                ? members.map(personName).join(", ")
                : "No members assigned yet. Choose this department in Members or Presets."}
            </p>
          </section>
        )}
        {(save.error ?? remove.error) && (
          <p role="alert" className="text-destructive text-sm">
            {save.error?.message ?? remove.error?.message}
          </p>
        )}
        {save.error?.data?.code === "CONFLICT" && department && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setName(department.name);
              setLeadIds(department.leadUserIds);
              setRevision(department.revision);
              setBaseline(
                JSON.stringify([
                  department.name,
                  [...department.leadUserIds].sort(),
                ]),
              );
              save.reset();
            }}
          >
            Reload saved department
          </Button>
        )}
      </div>
      {settings.viewer.canManageMembers && (
        <footer className="bg-card/95 sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t px-5 py-3 backdrop-blur">
          {department ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending || members.length > 0 || presetCount > 0}
              title={
                members.length || presetCount
                  ? "Move members and presets before deleting this department."
                  : undefined
              }
              onClick={async () => {
                if (
                  await confirmAction({
                    title: `Delete ${department.name}?`,
                    description:
                      "This department has no assigned members or presets.",
                    confirmLabel: "Delete department",
                    destructive: true,
                  })
                )
                  remove.mutate({
                    id: department.id,
                    revision: department.revision,
                  });
              }}
            >
              <Trash2Icon className="h-4 w-4" />
              Delete department
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            disabled={pending || !name.trim() || (!!department && !dirty)}
          >
            {pending ? "Saving…" : "Save department"}
          </Button>
        </footer>
      )}
    </form>
  );
}
