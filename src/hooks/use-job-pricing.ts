"use client";
import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import {
  findJobPrice,
  type JobPriceEntry,
  type JobPriceIndex,
} from "~/lib/job-pricing";

export function useJobPricing(jobId?: string | null) {
  const online = useOnlineStatus();
  return api.jobPricing.get.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: !!jobId && online,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  );
}
export function jobPriceStatus(
  book:
    | {
        policy: { active: boolean } | null;
        entries: readonly JobPriceEntry[] | JobPriceIndex;
      }
    | undefined,
  partId?: string | null,
  supplierId?: string | null,
  supplierPartId?: string | null,
) {
  if (!book?.policy?.active) return undefined;
  const entry = findJobPrice(book.entries, partId, supplierId, supplierPartId);
  if(entry?.preferJobPricing===false)return undefined;
  return !entry
    ? "unlisted"
    : entry.priceStatus === "confirmed"
      ? "confirmed"
      : entry.priceStatus === "estimated"
        ? "estimated"
        : "listed";
}
