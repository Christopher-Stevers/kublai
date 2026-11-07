"use client";
import { SupplierLabel } from "~/components/suppliers/SupplierLabel";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useOnlineStatus } from "~/hooks/use-online-status";

export function SupplierJobPricingDialog({
  supplierId,
  onClose,
}: {
  supplierId: string;
  onClose: () => void;
}) {
  const online = useOnlineStatus();
  const utils = api.useUtils();
  const query = api.supplierPriceBooks.assignments.useQuery(
    { supplierId },
    { enabled: online },
  );
  const assign = api.supplierPriceBooks.assign.useMutation();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const data = query.data;
  async function save(jobId: string, jobName: string, bookId: string) {
    setError(null);
    setMessage(null);
    try {
      await assign.mutateAsync({ supplierId, jobId, bookId: bookId || null });
      await Promise.all([
        utils.supplierPriceBooks.invalidate(),
        utils.jobPricing.invalidate(),
        utils.materialList.previewOrders.invalidate(),
      ]);
      setChoices((previous) => {
        const next = { ...previous };
        delete next[jobId];
        return next;
      });
      setMessage(
        `${jobName} now uses ${data?.books.find((b) => b.id === bookId)?.name ?? "Standard"} pricing.`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save job pricing. Try again.",
      );
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <SupplierLabel name={data?.supplier.name} bookName="Standard" fallback="Supplier" /> · Set Job Pricing
          </DialogTitle>
        </DialogHeader>
        {!online ? (
          <p>Connect to set job pricing.</p>
        ) : query.isLoading ? (
          <p>Loading jobs and price books…</p>
        ) : (
          <>
            {(error || query.error) && (
              <p role="alert" className="text-destructive">
                {error ?? query.error?.message}
              </p>
            )}
            {message && (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
            {data && (
              <>
                <p className="text-muted-foreground text-sm">
                  Choose a price book for each job. Parts outside the selected
                  book use Standard pricing.
                </p>
                {!data.canAssign && (
                  <p className="text-sm">
                    You can view these assignments. Job pricing permission is
                    required to change them.
                  </p>
                )}
                <Input
                  aria-label="Search jobs"
                  placeholder="Search jobs"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="divide-y">
                  {data.jobs
                    .filter((j) =>
                      j.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((job) => {
                      const selected = choices[job.id] ?? job.bookId ?? "";
                      return (
                        <div
                          key={job.id}
                          className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center"
                        >
                          <label
                            htmlFor={`job-pricing-${job.id}`}
                            className="text-sm font-medium"
                          >
                            {job.name}
                          </label>
                          <select
                            id={`job-pricing-${job.id}`}
                            aria-label={`Price book for ${job.name}`}
                            className="bg-background w-full min-w-0 rounded-md border p-2 text-sm"
                            disabled={!data.canAssign || assign.isPending}
                            value={selected}
                            onChange={(e) => {
                              setChoices((v) => ({
                                ...v,
                                [job.id]: e.target.value,
                              }));
                              setMessage(null);
                              setError(null);
                            }}
                          >
                            <option value="">Standard</option>
                            {data.books.map((book) => (
                              <option key={book.id} value={book.id}>
                                {book.name}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="outline"
                            aria-label={`Save pricing for ${job.name}`}
                            disabled={
                              !data.canAssign ||
                              assign.isPending ||
                              selected === (job.bookId ?? "")
                            }
                            onClick={() =>
                              void save(job.id, job.name, selected)
                            }
                          >
                            Save
                          </Button>
                        </div>
                      );
                    })}
                </div>
                {!data.jobs.length && <p>No jobs yet.</p>}
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
