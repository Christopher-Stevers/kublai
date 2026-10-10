"use client";

import {
  BriefcaseIcon,
  Building2Icon,
  LayoutGridIcon,
  ListChecksIcon,
  MapIcon,
  PackageIcon,
  ReceiptIcon,
  ShoppingCartIcon,
  TruckIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

import {
  PERMISSION_GROUPS,
  PERMISSION_PRESETS,
  matchingPreset,
  type PermissionKey,
  type PermissionMap,
} from "~/lib/permission-catalog";
import { cn } from "~/lib/utils";

const GROUP_ICONS: Record<string, LucideIcon> = {
  layout: LayoutGridIcon,
  briefcase: BriefcaseIcon,
  list: ListChecksIcon,
  cart: ShoppingCartIcon,
  package: PackageIcon,
  truck: TruckIcon,
  map: MapIcon,
  receipt: ReceiptIcon,
  wrench: WrenchIcon,
  building: Building2Icon,
};

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/25",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function countAllowed(map: PermissionMap) {
  const keys = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
  return { allowed: keys.filter((k) => map[k]).length, total: keys.length };
}

export function roleLabel(map: PermissionMap) {
  return matchingPreset(map)?.label ?? "Custom";
}

/** Starting templates + grouped permission switches. Templates copy values; saved organization presets stay linked. */
export function PermissionEditor({
  value,
  onChange,
  disabled,
  lockedKeys = [],
  showPresets = true,
}: {
  value: PermissionMap;
  onChange: (next: PermissionMap) => void;
  disabled?: boolean;
  /** Keys that can't be changed here (e.g. your own access to this page). */
  lockedKeys?: PermissionKey[];
  /** Hide the Quick setup row when the screen shows its own presets. */
  showPresets?: boolean;
}) {
  const preset = matchingPreset(value);
  const set = (key: PermissionKey, on: boolean) => {
    if (lockedKeys.includes(key)) return;
    onChange({ ...value, [key]: on });
  };
  const applyPreset = (map: PermissionMap) => {
    const next = { ...map };
    for (const key of lockedKeys) next[key] = value[key];
    onChange(next);
  };

  return (
    <div className="space-y-5">
      {showPresets && (
        <>
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Starting template
        </p>
        <div className="flex flex-wrap gap-2">
          {PERMISSION_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => applyPreset(p.permissions)}
              title={p.description}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
                preset?.id === p.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/50 hover:bg-accent",
              )}
            >
              {p.label}
            </button>
          ))}
          {!preset && (
            <span className="rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground">
              Custom
            </span>
          )}
        </div>
        {preset && (
          <p className="mt-2 text-xs text-muted-foreground">{preset.description}</p>
        )}
      </div>

        </>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {PERMISSION_GROUPS.map((group) => {
          const Icon = GROUP_ICONS[group.icon] ?? LayoutGridIcon;
          const keys = group.permissions.map((p) => p.key);
          const on = keys.filter((k) => value[k]).length;
          const allOn = on === keys.length;
          return (
            <section
              key={group.id}
              className={cn(
                "rounded-xl border bg-card p-4 shadow-xs",
                group.id === "pages" && "lg:col-span-2",
              )}
            >
              <header className="mb-3 flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  <p className="text-xs text-muted-foreground">{group.description}</p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const next = { ...value };
                    for (const k of keys) if (!lockedKeys.includes(k)) next[k] = !allOn;
                    onChange(next);
                  }}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {on}/{keys.length} · {allOn ? "None" : "All"}
                </button>
              </header>
              <ul
                className={cn(
                  "divide-y",
                  group.id === "pages" && "grid gap-x-6 divide-y-0 sm:grid-cols-2",
                )}
              >
                {group.permissions.map((p) => {
                  const locked = lockedKeys.includes(p.key);
                  return (
                    <li
                      key={p.key}
                      className={cn(
                        "flex items-center gap-3 py-2.5",
                        group.id === "pages" && "border-b last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{p.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {locked ? "You can't remove this from yourself." : p.description}
                        </p>
                      </div>
                      <Switch
                        checked={value[p.key]}
                        onChange={(v) => set(p.key, v)}
                        disabled={disabled || locked}
                        label={p.label}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const AVATAR_COLOURS = [
  "bg-sky-100 text-sky-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
  "bg-teal-100 text-teal-800",
  "bg-orange-100 text-orange-800",
  "bg-indigo-100 text-indigo-800",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const initials =
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        AVATAR_COLOURS[hash % AVATAR_COLOURS.length],
        size === "lg" ? "h-14 w-14 text-lg" : "h-10 w-10 text-sm",
      )}
    >
      {initials}
    </span>
  );
}
