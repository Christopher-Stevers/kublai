"use client";
import { useLayoutEffect, useState } from "react";
import { hashKey, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";

/** Saved history is evidence of a past read, not current membership. Require a
 * successful overview response after this reader opens or becomes active again.
 * Manual cache updates and hydration cannot establish this authority. */
export function useJobChatAuthority(
  key: QueryKey,
  enabled: boolean,
  userId: string,
  overview: { isSuccess: boolean; data?: { userId: string }; error: unknown },
) {
  const client = useQueryClient();
  const hash = hashKey(key);
  const [boundary, setBoundary] = useState(() => ({ hash, enabled, userId }));
  const [accepted, setAccepted] = useState<{
    boundary: typeof boundary;
    query: object;
    data: unknown;
    authority: ReturnType<typeof captureDeviceReadAuthority>;
  } | null>(null);
  const same =
    boundary.hash === hash &&
    boundary.enabled === enabled &&
    boundary.userId === userId;
  if (!same) setBoundary({ hash, enabled, userId });
  useLayoutEffect(() => {
    if (!enabled) return;
    const authority = captureDeviceReadAuthority();
    return client.getQueryCache().subscribe((event) => {
      if (
        event.query.queryHash !== hash ||
        event.type !== "updated" ||
        event.action.type !== "success" ||
        client.getQueryCache().get(hash) !== event.query ||
        authority !== captureDeviceReadAuthority()
      ) return;
      // Even a manual same-object update cannot renew a permission certificate.
      if (event.action.manual) {
        setAccepted(null);
        return;
      }
      setAccepted({
        boundary,
        query: event.query,
        data: event.action.data,
        authority,
      });
    });
  }, [client, hash, enabled, boundary]);
  return (
    enabled &&
    same &&
    accepted?.boundary === boundary &&
    accepted.query === client.getQueryCache().get(hash) &&
    accepted.authority === captureDeviceReadAuthority() &&
    accepted.data === overview.data &&
    overview.isSuccess &&
    !overview.error &&
    overview.data?.userId === userId
  );
}
