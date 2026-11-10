"use client";
import { useQuery } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import type { DrawingWorkspace } from "~/lib/drawing-workspace";
import { api } from "~/trpc/react";

/** Keep the existing workspace cache/invalidation API; poll only its validator. */
export function useDrawingWorkspaceQuery(sheetId: string, online: boolean, hyperlinksVisible = true) {
  const utils = api.useUtils();
  // Separate validator caches: a hidden response cannot satisfy an enabled layer.
  const input = hyperlinksVisible ? { sheetId } : { sheetId, omitHyperlinks: true as const };
  return useQuery<DrawingWorkspace, TRPCClientErrorLike<AppRouter>>({
    queryKey: getQueryKey(api.drawingsWorkspace.get, input, "query"),
    placeholderData: previous => previous?.sheetId === sheetId ? previous : undefined,
    queryFn: async ({ signal }) => {
      const cached = utils.drawingsWorkspace.get.getData(input);
      const result = await utils.client.drawingsWorkspace.changes.query(
        { sheetId, revision: cached?.revision, deferLinks: true, ...(!hyperlinksVisible ? { omitHyperlinks: true } : {}) },
        { signal },
      );
      if (result.workspace) return result.workspace;
      if (cached?.revision === result.revision) return cached;
      // A cache reset or an old persisted snapshot must recover with full data.
      return utils.client.drawingsWorkspace.get.query({ ...input, deferLinks: true }, { signal });
    },
    refetchInterval: online ? 15_000 : false,
    retry: 1,
  });
}
