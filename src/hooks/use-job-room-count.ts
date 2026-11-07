"use client";

import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";

/** The menu needs only the permission-filtered count, not every room polygon. */
export function useJobRoomCount(jobId: string | null, enabled = true) {
  const isOnline = useOnlineStatus();
  const query = api.rooms.getJobRoomCount.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: isOnline && Boolean(jobId) && enabled,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  );
  const count = jobId ? query.data?.count : undefined;

  return { count, loading: count === undefined && query.isFetching };
}
