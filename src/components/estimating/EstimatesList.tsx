"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRightIcon,
  PlusIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import {
  estimateStatusSchema,
  type EstimateListRecord,
  type EstimateStatus,
} from "~/lib/estimating";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useEstimatingPermissions } from "./EstimatingAccess";
import { PricebookDialog } from "./PricebookDialog";
import {
  actionClass,
  errorMessage,
  Field,
  money,
  selectClass,
  shortDate,
  StatusBadge,
  statusLabels,
} from "./estimating-ui";

export function EstimatesList() {
  const permissions = useEstimatingPermissions();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<EstimateStatus | "">("");
  const [jobId, setJobId] = useState("");
  const [cursor, setCursor] = useState<
    { updatedAt: string; id: string } | undefined
  >();
  const [earlierItems, setEarlierItems] = useState<EstimateListRecord[]>([]);
  const resetPages = () => {
    setCursor(undefined);
    setEarlierItems([]);
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [newJobId, setNewJobId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const jobs = api.estimating.jobs.useQuery(undefined, {
    enabled: permissions.allowed,
  });
  const estimates = api.estimating.list.useQuery(
    {
      search: search || undefined,
      status: status || undefined,
      jobId: jobId || undefined,
      cursor,
      limit: 50,
    },
    { enabled: permissions.allowed },
  );
  const create = api.estimating.create.useMutation();
  const items = [
    ...new Map(
      [...earlierItems, ...(estimates.data?.items ?? [])].map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ];
  const createEstimate = async () => {
    if (!newJobId || !name.trim() || create.isPending) return;
    setError("");
    try {
      const record = await create.mutateAsync({
        jobId: newJobId,
        name: name.trim(),
      });
      router.push(`/dashboard/estimating/${record.id}`);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-[0.14em] uppercase">
            Commercial workspace
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Estimating
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Build job costs, review drawing evidence, and prepare a customer
            proposal.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setPricingOpen(true)}>
            <SlidersHorizontalIcon className="mr-2 h-4 w-4" />
            Pricebook & assemblies
          </Button>
          {permissions.edit && (
            <Button
              className={actionClass}
              onClick={() => {
                setCreateOpen(true);
                setError("");
              }}
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              New estimate
            </Button>
          )}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-3 border-y py-3">
        <div className="relative min-w-56 flex-1">
          <SearchIcon className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
          <Input
            aria-label="Search estimates"
            placeholder="Search estimate or job…"
            value={search}
            onChange={(event) => {
              resetPages();
              setSearch(event.target.value);
            }}
            className="pl-9"
          />
        </div>
        <select
          aria-label="Filter by job"
          value={jobId}
          onChange={(event) => {
            resetPages();
            setJobId(event.target.value);
          }}
          className={`${selectClass} max-w-full sm:w-56`}
        >
          <option value="">All jobs</option>
          {jobs.data?.map((job) => (
            <option key={job.id} value={job.id}>
              {job.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by estimate status"
          value={status}
          onChange={(event) => {
            resetPages();
            setStatus(event.target.value as EstimateStatus | "");
          }}
          className={`${selectClass} sm:w-40`}
        >
          <option value="">All statuses</option>
          {estimateStatusSchema.options.map((value) => (
            <option key={value} value={value}>
              {statusLabels[value]}
            </option>
          ))}
        </select>
      </div>
      {estimates.error && (
        <p role="alert" className="text-destructive my-4 text-sm">
          {estimates.error.message}
          <Button variant="link" onClick={() => void estimates.refetch()}>
            Retry
          </Button>
        </p>
      )}
      <div className="bg-background overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-xs">
            <tr>
              <th className="p-4 font-medium">Estimate / job</th>
              <th className="p-4 font-medium">Status</th>
              <th className="p-4 text-right font-medium">Selling price</th>
              <th className="p-4 font-medium">Review</th>
              <th className="p-4 font-medium">Updated</th>
              <th className="w-12 p-4">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((estimate) => {
              return (
                <tr
                  key={estimate.id}
                  className="hover:bg-muted/30 transition-colors"
                >
                  <td className="p-4">
                    <Link
                      href={`/dashboard/estimating/${estimate.id}`}
                      className="block font-medium hover:text-blue-600"
                    >
                      {estimate.name}
                    </Link>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {estimate.jobName} · Revision {estimate.revision}
                    </span>
                  </td>
                  <td className="p-4">
                    <StatusBadge status={estimate.status} />
                  </td>
                  <td className="p-4 text-right font-semibold tabular-nums">
                    {money(estimate.summary.total, estimate.summary.currency)}
                  </td>
                  <td className="text-muted-foreground p-4 text-xs">
                    {estimate.summary.readiness.ready
                      ? "Ready"
                      : "Needs review"}
                  </td>
                  <td className="text-muted-foreground p-4 text-xs">
                    {shortDate(estimate.updatedAt)}
                  </td>
                  <td className="p-4">
                    <Link
                      href={`/dashboard/estimating/${estimate.id}`}
                      aria-label={`Open ${estimate.name}`}
                      className="hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded"
                    >
                      <ArrowUpRightIcon className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {estimates.isLoading && (
          <p
            role="status"
            className="text-muted-foreground px-4 py-12 text-center text-sm"
          >
            Loading estimates…
          </p>
        )}
        {!estimates.isLoading && !estimates.error && items.length === 0 && (
          <div className="px-6 py-16 text-center">
            <h2 className="text-lg font-semibold">
              {search || status || jobId
                ? "No matching estimates"
                : "Your estimating register is ready"}
            </h2>
            <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
              {search || status || jobId
                ? "Adjust the search or filters to find an estimate."
                : "Start with a job, add quantities and rates, then review the scope before approval."}
            </p>
            {permissions.edit && !search && !status && !jobId && (
              <Button
                onClick={() => setCreateOpen(true)}
                className={`mt-5 ${actionClass}`}
              >
                Create an estimate
              </Button>
            )}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="text-muted-foreground mt-3 flex items-center justify-between gap-3 text-xs">
          <span>{items.length} estimates loaded</span>
          {estimates.data?.nextCursor && (
            <Button
              size="sm"
              variant="outline"
              disabled={estimates.isFetching}
              onClick={() => {
                if (estimates.data?.nextCursor) {
                  setEarlierItems(items);
                  setCursor(estimates.data.nextCursor);
                }
              }}
            >
              {estimates.isFetching ? "Loading…" : "Load more estimates"}
            </Button>
          )}
        </div>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New estimate</DialogTitle>
            <DialogDescription>
              Choose the job whose drawings and material lists will supply the
              takeoff.
            </DialogDescription>
          </DialogHeader>
          <Field label="Job">
            <select
              className={selectClass}
              value={newJobId}
              onChange={(event) => setNewJobId(event.target.value)}
            >
              <option value="">Select a job</option>
              {jobs.data?.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>
          </Field>
          {jobs.error && (
            <p role="alert" className="text-destructive text-sm">
              {jobs.error.message}
            </p>
          )}
          <Field label="Estimate name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Base bid — mechanical scope"
              maxLength={255}
            />
          </Field>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              className={actionClass}
              disabled={!newJobId || !name.trim() || create.isPending}
              onClick={() => void createEstimate()}
            >
              {create.isPending ? "Creating…" : "Create estimate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PricebookDialog
        open={pricingOpen}
        onOpenChange={setPricingOpen}
        canEdit={permissions.edit}
      />
    </div>
  );
}
