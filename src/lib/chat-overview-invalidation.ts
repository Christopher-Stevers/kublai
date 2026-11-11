import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { observeLiveHints } from "./live-client";

/** Passive observer: cache keys shared by thread and both job-home callers.
 * This does not subscribe to jobs, request new sources, or suppress polling. */
export function bindChatOverviewInvalidation(
  client: QueryClient,
  key: (jobId: string) => QueryKey,
) {
  return observeLiveHints((hint) => {
    if (hint.topic === "chat-overview" && hint.key)
      void client.invalidateQueries({ queryKey: key(hint.key), exact: true });
  });
}
