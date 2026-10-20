"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalculatorIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDashedIcon,
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
import { Skeleton } from "~/components/ui/skeleton";
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
  const filtered = Boolean(search || status || jobId);
  const openCreate = () => {
    setCreateOpen(true);
    setError("");
  };
  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 px-4 pt-6 pb-28 sm:px-6 sm:pb-10 lg:px-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-foreground text-2xl font-bold sm:text-3xl">
            Estimating
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Job costs, takeoffs and customer proposals
          </p>
        </div>
        <div className="hidden shrink-0 gap-2 sm:flex">
          <Button variant="outline" onClick={() => setPricingOpen(true)}>
            <SlidersHorizontalIcon className="h-4 w-4" />
            Pricebook & assemblies
          </Button>
          {permissions.edit && (
            <Button className={actionClass} onClick={openCreate}>
              <PlusIcon className="h-4 w-4" />
              New estimate
            </Button>
          )}
        </div>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <div className="relative col-span-2 min-w-0 sm:flex-1">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            aria-label="Search estimates"
            placeholder="Search estimate or job…"
            value={search}
            onChange={(event) => {
              resetPages();
              setSearch(event.target.value);
            }}
            className="bg-card h-11 rounded-lg pl-9 sm:h-9"
          />
        </div>
        <select
          aria-label="Filter by job"
          value={jobId}
          onChange={(event) => {
            resetPages();
            setJobId(event.target.value);
          }}
          className={`${selectClass} bg-card w-full sm:w-52`}
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
          className={`${selectClass} bg-card w-full sm:w-40`}
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
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive mb-4 rounded-lg border px-4 py-3 text-sm"
        >
          {estimates.error.message}
          <Button variant="link" onClick={() => void estimates.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {estimates.isLoading ? (
        <div role="status" aria-label="Loading estimates" className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-20 rounded-xl w-full" />
          ))}
        </div>
      ) : !estimates.error && items.length === 0 ? (
        <div className="bg-card flex flex-col items-center rounded-xl border px-6 py-14 text-center">
          <span className="bg-primary/10 text-primary mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <CalculatorIcon className="h-7 w-7" />
          </span>
          <h2 className="text-lg font-semibold">
            {filtered ? "No matching estimates" : "No estimates yet"}
          </h2>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            {filtered
              ? "Adjust the search or filters to find an estimate."
              : "Start with a job, add quantities and rates, then review the scope before approval."}
          </p>
          {permissions.edit && !filtered && (
            <Button onClick={openCreate} className={`mt-5 ${actionClass}`}>
              <PlusIcon className="h-4 w-4" />
              Create an estimate
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((estimate) => (
            <li key={estimate.id}>
              <Link
                href={`/dashboard/estimating/${estimate.id}`}
                aria-label={`Open ${estimate.name}`}
                className="bg-card hover:border-primary/40 focus-visible:ring-ring flex min-w-0 items-center gap-3 rounded-xl border p-4 shadow-sm transition-[border-color,box-shadow] hover:shadow-md focus-visible:ring-2 focus-visible:outline-none sm:gap-4"
              >
                <span className="bg-primary/10 text-primary hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl sm:flex">
                  <CalculatorIcon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {estimate.name}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                    {estimate.jobName} · Revision {estimate.revision} ·{" "}
                    {shortDate(estimate.updatedAt)}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge status={estimate.status} />
                    <span
                      className={`inline-flex items-center gap-1 text-xs ${estimate.summary.readiness.ready ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
                    >
                      {estimate.summary.readiness.ready ? (
                        <CheckCircle2Icon className="h-3.5 w-3.5" />
                      ) : (
                        <CircleDashedIcon className="h-3.5 w-3.5" />
                      )}
                      {estimate.summary.readiness.ready
                        ? "Ready"
                        : "Needs review"}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-base font-semibold tabular-nums sm:text-lg">
                    {money(estimate.summary.total, estimate.summary.currency)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Selling price
                  </span>
                </span>
                <ChevronRightIcon className="text-muted-foreground hidden h-5 w-5 shrink-0 sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {estimates.data?.nextCursor && (
        <div className="mt-4 text-center">
          <Button
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
        </div>
      )}
      <div className="bg-background fixed inset-x-0 bottom-0 z-40 pin-viewport-bottom flex gap-2 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">
        <Button
          variant="outline"
          size="lg"
          className="h-12 flex-1"
          onClick={() => setPricingOpen(true)}
        >
          <SlidersHorizontalIcon className="h-5 w-5" />
          Pricebook
        </Button>
        {permissions.edit && (
          <Button
            size="lg"
            className={`h-12 flex-1 ${actionClass}`}
            onClick={openCreate}
          >
            <PlusIcon className="h-5 w-5" />
            New estimate
          </Button>
        )}
      </div>
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
