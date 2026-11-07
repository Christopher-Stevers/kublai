"use client";
import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";


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
export { jobPriceStatus } from "~/lib/job-price-status";
