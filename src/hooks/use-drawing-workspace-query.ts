"use client";
import { useQuery } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import type { DrawingWorkspace } from "~/lib/drawing-workspace";
import { api } from "~/trpc/react";

/** Keep the existing workspace cache/invalidation API; poll only its validator. */
export function useDrawingWorkspaceQuery(sheetId: string, online: boolean) {
  const utils = api.useUtils();
  return useQuery<DrawingWorkspace, TRPCClientErrorLike<AppRouter>>({
    queryKey: getQueryKey(api.drawingsWorkspace.get, { sheetId }, "query"),
    queryFn: async ({ signal }) => {
      const cached = utils.drawingsWorkspace.get.getData({ sheetId });
      const result = await utils.client.drawingsWorkspace.changes.query(
        { sheetId, revision: cached?.revision },
        { signal },
      );
      if (result.workspace) return result.workspace;
      if (cached?.revision === result.revision) return cached;
      // A cache reset or an old persisted snapshot must recover with full data.
      return utils.client.drawingsWorkspace.get.query({ sheetId }, { signal });
    },
    refetchInterval: online ? 15_000 : false,
    retry: 1,
  });
}
