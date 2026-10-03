"use client";

import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";

/** Share the room screen's permission-filtered data and mutation invalidations. */
export function useJobRoomCount(jobId: string | null, enabled = true) {
  const isOnline = useOnlineStatus();
  const query = api.rooms.getJobRooms.useQuery(
    { jobId: jobId ?? "" },
    {
      enabled: isOnline && Boolean(jobId) && enabled,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  );
  const count =
    jobId && query.data
      ? query.data.floors.reduce(
          (total, floor) =>
            total +
            floor.rooms.filter(
              (room) =>
                room.reviewStatus !== "rejected" &&
                room.reviewStatus !== "superseded",
            ).length,
          0,
        )
      : undefined;
  return { count, loading: count === undefined && query.isFetching };
}
