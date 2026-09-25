"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ChevronRightIcon, InboxIcon, UserIcon, WrenchIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ListPageSkeleton } from "~/components/ui/skeleton";
import { toolScanPath } from "~/lib/asset-tags";
import { api } from "~/trpc/react";

import {
  AssetsShell,
  ErrorText,
  HolderLabel,
  RequestStatusBadge,
  ToolStatusBadge,
  formatWhen,
  holderHref,
  useIsOnline,
  type HolderRef,
} from "./shared";
import { TagScanner } from "./TagScanner";

function Stat({ label, value, href, tone }: { label: string; value: number; href: string; tone?: string }) {
  return (
    <Link href={href} className="bg-card hover:bg-accent rounded-lg border p-3 transition-colors">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
    </Link>
  );
}

export function AssetsOverview() {
  const router = useRouter();
  const isOnline = useIsOnline();
  const utils = api.useUtils();
  const overview = api.assets.overview.useQuery(undefined, { enabled: isOnline });
  const holders = api.assets.holders.useQuery(undefined, { enabled: isOnline });
  const requests = api.assets.listRequests.useQuery({ status: "open" }, { enabled: isOnline });
  const damaged = api.assets.listAssets.useQuery({ status: "damaged", limit: 20 }, { enabled: isOnline });
  const missing = api.assets.listAssets.useQuery({ status: "missing", limit: 20 }, { enabled: isOnline });
  const setup = api.assets.setup.useMutation({
    onSuccess: () => utils.assets.invalidate(),
  });

  const data = overview.data;
  const me: HolderRef | null = holders.data?.me ? { type: "user", id: holders.data.me } : null;
  const problems = [...(damaged.data ?? []), ...(missing.data ?? [])];

  return (
    <AssetsShell
      title="Asset Management"
      description="Company tools and equipment: where they are, who has them, and what's needed"
      actions={
        me && (
          <Button variant="outline" asChild>
            <Link href={holderHref(me)}>
              <UserIcon className="mr-2 h-4 w-4" /> My tools
            </Link>
          </Button>
        )
      }
    >
      {overview.isLoading ? (
        <ListPageSkeleton label="Loading asset management" />
      ) : overview.error ? (
        <ErrorText message={overview.error.message} />
      ) : !data?.isSetUp ? (
        <div className="bg-card rounded-lg border p-6">
          <WrenchIcon className="text-muted-foreground h-10 w-10" />
          <h3 className="mt-3 text-lg font-semibold">Set up the tool room</h3>
          <p className="text-muted-foreground mt-1 max-w-prose text-sm">
            This creates a Tool Room (where tool requests are sent), a &ldquo;Tools &amp;
            Equipment&rdquo; catalog for tool types, and a Main Yard location. You can rename
            and add more afterwards.
          </p>
          {data?.canManageAssets ? (
            <Button className="mt-4" onClick={() => setup.mutate()} disabled={setup.isPending}>
              {setup.isPending ? "Setting up…" : "Set up Asset Management"}
            </Button>
          ) : (
            <p className="mt-4 text-sm">
              Ask an admin to set this up, or to give someone the Tool Room permission on the
              Organization page.
            </p>
          )}
          <ErrorText message={setup.error?.message} />
        </div>
      ) : (
        <div className="space-y-6">
          <TagScanner onTag={(tag) => router.push(toolScanPath(tag))} />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Tools" value={data.tools.total - data.tools.retired} href="/dashboard/assets/tools" />
            <Stat label="Available" value={data.tools.available} href="/dashboard/assets/tools?status=available" tone="text-emerald-700" />
            <Stat label="In use" value={data.tools.inUse} href="/dashboard/assets/tools?status=in_use" tone="text-sky-700" />
            <Stat label="Damaged" value={data.tools.damaged} href="/dashboard/assets/tools?status=damaged" tone={data.tools.damaged ? "text-amber-700" : ""} />
            <Stat label="Missing" value={data.tools.missing} href="/dashboard/assets/tools?status=missing" tone={data.tools.missing ? "text-red-700" : ""} />
            <Stat label="Open requests" value={data.openRequests} href="/dashboard/assets/requests" />
            <Stat label="Returns to receive" value={data.openReturns} href="/dashboard/assets/requests?kind=tool_return" />
            <Stat label="Counts in progress" value={data.openCounts} href="/dashboard/assets/counts" />
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Waiting on the tool room</h3>
              <Link href="/dashboard/assets/requests" className="text-primary text-sm hover:underline">
                All requests
              </Link>
            </div>
            {requests.data && requests.data.length === 0 ? (
              <p className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm">
                <InboxIcon className="h-4 w-4" /> Nothing waiting. Foremen send tool requests from a job&apos;s
                &ldquo;Tool Request&rdquo; list.
              </p>
            ) : (
              <div className="bg-card divide-y rounded-lg border">
                {(requests.data ?? []).slice(0, 6).map((r) => (
                  <Link key={r.id} href={`/dashboard/assets/requests/${r.id}`} className="hover:bg-accent flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.orderNumber}</span>
                        <RequestStatusBadge status={r.fulfillmentStatus} kind={r.kind} />
                      </div>
                      <div className="text-muted-foreground truncate text-xs sm:text-sm">
                        {r.kind === "tool_return" ? "Return from " : "For "}
                        {r.jobName ?? "job"} · {r.requestedBy ?? "someone"} · {formatWhen(r.sentAt)}
                      </div>
                    </div>
                    <ChevronRightIcon className="text-muted-foreground h-4 w-4" />
                  </Link>
                ))}
              </div>
            )}
          </section>

          {problems.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 font-semibold">
                <AlertTriangleIcon className="h-4 w-4 text-amber-600" /> Damaged or missing
              </h3>
              <div className="bg-card divide-y rounded-lg border">
                {problems.map((tool) => (
                  <Link key={tool.id} href={`/dashboard/assets/tools/${tool.id}`} className="hover:bg-accent flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{tool.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">{tool.assetTag}</span>
                        <ToolStatusBadge status={tool.status} />
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs sm:text-sm">
                        <HolderLabel label={tool.holder.label} kind={tool.holder.kind} />
                      </div>
                    </div>
                    <ChevronRightIcon className="text-muted-foreground h-4 w-4" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </AssetsShell>
  );
}
