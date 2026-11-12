"use client";

import Link from "next/link";
import { getQueryKey } from "@trpc/react-query";
import { useTierOneReadOptions, blocksCachedRead } from "~/hooks/use-tier-one-read-options";
import { DeviceReadNotice } from "~/components/ui/device-read-notice";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRightIcon, InboxIcon } from "lucide-react";

import { ListPageSkeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

import { AssetsShell, EmptyState, ErrorText, RequestStatusBadge, formatQty, formatWhen, useIsOnline } from "./shared";

const STATUS_TABS = [
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
] as const;
const KIND_TABS = [
  { id: "", label: "Requests & returns" },
  { id: "tool_request", label: "Requests" },
  { id: "tool_return", label: "Returns" },
] as const;

export function RequestsView() {
  const router = useRouter();
  const params = useSearchParams();
  const isOnline = useIsOnline();
  const status = (["open", "done", "all"] as const).find((s) => s === params.get("status")) ?? "open";
  const kind = (["tool_request", "tool_return"] as const).find((k) => k === params.get("kind"));
  const input = { status, kind };
  const requests = api.assets.listRequests.useQuery(
    input,
    useTierOneReadOptions(getQueryKey(api.assets.listRequests, input, "query"), isOnline),
  );

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/jobs/assets/requests${next.size ? `?${next}` : ""}`);
  };

  const pill = (active: boolean) =>
    cn(
      "rounded-md px-2.5 py-1 text-sm",
      active ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <AssetsShell
      title="Requests & returns"
      description="Tool requests sent from job lists, and tools coming back from jobs"
    >
      <div className="flex flex-wrap gap-2">
        <div className="bg-muted flex gap-1 rounded-lg p-1">
          {STATUS_TABS.map((tab) => (
            <button key={tab.id} className={pill(status === tab.id)} onClick={() => setParam("status", tab.id === "open" ? "" : tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
        <div className="bg-muted flex gap-1 rounded-lg p-1">
          {KIND_TABS.map((tab) => (
            <button key={tab.id} className={pill((kind ?? "") === tab.id)} onClick={() => setParam("kind", tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <DeviceReadNotice query={requests} />
      {requests.isLoading ? (
        <ListPageSkeleton label="Loading requests" />
      ) : blocksCachedRead(requests) ? (
        <ErrorText message={requests.error?.message} />
      ) : requests.data === undefined ? (
        <p role="status" className="text-muted-foreground text-sm">
          {isOnline ? "Requests are not available yet. Reopen this view to load them." : "Requests are unavailable offline. Connect to load them."}
        </p>
      ) : !requests.data.length ? (
        <EmptyState icon={<InboxIcon />} title={status === "open" ? "Nothing waiting" : "Nothing here"}>
          Foremen request tools from a job: Material Lists → Tool Request. Returns are started from a
          job&apos;s tools under Where.
        </EmptyState>
      ) : (
        <div className="bg-card divide-y rounded-lg border">
          {requests.data.map((r) => (
            <Link key={r.id} href={`/jobs/assets/requests/${r.id}`} className="hover:bg-accent flex items-center gap-3 p-3 sm:p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.orderNumber}</span>
                  <span className="text-muted-foreground text-xs">{r.kind === "tool_return" ? "Return" : "Request"}</span>
                  <RequestStatusBadge status={r.fulfillmentStatus} kind={r.kind} />
                </div>
                <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 text-xs sm:text-sm">
                  <span>{r.jobName ?? "Job"}</span>
                  <span>{r.requestedBy ?? "Unknown"}</span>
                  <span>{formatWhen(r.sentAt)}</span>
                  <span>
                    {formatQty(r.fulfilledQuantity)} of {formatQty(r.totalQuantity)} {r.kind === "tool_return" ? "received" : "filled"}
                  </span>
                </div>
              </div>
              <ChevronRightIcon className="text-muted-foreground h-5 w-5 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </AssetsShell>
  );
}
