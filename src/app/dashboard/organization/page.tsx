"use client";

import { usePageViewState } from "~/hooks/use-page-view-state";
import { Building2Icon, MapPinIcon, QrCodeIcon, UsersIcon, WifiOffIcon } from "lucide-react";

import { CompanySection } from "~/components/organization/CompanySection";
import { InvitesSection } from "~/components/organization/InvitesSection";
import { MembersSection } from "~/components/organization/MembersSection";
import { FormSkeleton } from "~/components/ui/skeleton";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

const SECTIONS = [
  { id: "members", label: "Members", icon: UsersIcon },
  { id: "invites", label: "Invites", icon: QrCodeIcon },
  { id: "company", label: "Company", icon: MapPinIcon },
] as const;

export default function OrganizationPage() {
  const isOnline = useOnlineStatus();
  const utils = api.useUtils();
  const [section, setSection] = usePageViewState<(typeof SECTIONS)[number]["id"]>("organization:section", "members", ["members", "invites", "company"]);
  const settings = api.organization.getOrganizationSettings.useQuery(undefined, { enabled: isOnline, retry: false });
  const refresh = async () => {
    await utils.organization.getOrganizationSettings.invalidate();
    await utils.user.getMyRole.invalidate();
  };

  const data = settings.data;
  const pending = data?.members.filter((m) => m.organizationAccessStatus === "pending").length ?? 0;

  return (
    <div className="px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Building2Icon className="h-7 w-7" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold sm:text-3xl">{data?.organization.name ?? "Organization"}</h1>
            {data && (
              <p className="text-sm text-muted-foreground">
                {data.members.length} member{data.members.length === 1 ? "" : "s"}
                {pending > 0 && <span className="font-medium text-amber-700"> · {pending} waiting for approval</span>} · {data.invites.length} active invite
                {data.invites.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1 shadow-xs sm:w-fit" aria-label="Organization sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                section === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {id === "members" && pending > 0 && (
                <span className={cn("rounded-full px-1.5 text-[11px] font-semibold", section === id ? "bg-white/25" : "bg-amber-500 text-white")}>{pending}</span>
              )}
            </button>
          ))}
        </nav>

        {!isOnline ? (
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
            <WifiOffIcon className="h-4 w-4" /> Organization settings need an internet connection.
          </div>
        ) : settings.isLoading ? (
          <div className="rounded-2xl border bg-card p-6">
            <FormSkeleton label="Loading organization" />
          </div>
        ) : settings.error || !data ? (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">{settings.error?.message ?? "Could not load the organization."}</div>
        ) : section === "members" ? (
          <MembersSection settings={data} onSaved={refresh} />
        ) : section === "invites" ? (
          <InvitesSection settings={data} onSaved={refresh} />
        ) : (
          <CompanySection settings={data} onSaved={refresh} />
        )}
      </div>
    </div>
  );
}
