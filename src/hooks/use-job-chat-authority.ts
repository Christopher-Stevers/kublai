"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
  type Certificate = {
    boundary: typeof boundary;
    query: object;
    data: unknown;
    authority: ReturnType<typeof captureDeviceReadAuthority>;
  };
  const [accepted, setAccepted] = useState<Certificate | null>(null);
  const current = useRef<Certificate | null>(null);
  const same =
    boundary.hash === hash &&
    boundary.enabled === enabled &&
    boundary.userId === userId;
  if (!same) setBoundary({ hash, enabled, userId });
  useLayoutEffect(() => {
    if (!enabled) return;
    const authority = captureDeviceReadAuthority();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (
        event.query.queryHash !== hash ||
        event.type !== "updated" ||
        event.action.type !== "success" ||
        client.getQueryCache().get(hash) !== event.query ||
        authority !== captureDeviceReadAuthority()
      )
        return;
      // Even a manual same-object update cannot renew a permission certificate.
      if (event.action.manual) {
        current.current = null;
        setAccepted(null);
        return;
      }
      const certificate: Certificate = {
        boundary,
        query: event.query,
        data: event.action.data,
        authority,
      };
      current.current = certificate;
      setAccepted(certificate);
    });
    return () => {
      // Activity destroys effects while retaining state. Revoke synchronously
      // when hidden, before any retained passive mutation effect can reconnect.
      current.current = null;
      unsubscribe();
      setAccepted(null);
    };
  }, [client, hash, enabled, boundary]);
  const isCurrent = useCallback(() => {
    const certificate = current.current;
    const query = client.getQueryCache().get(hash);
    const data = certificate?.data;
    return (
      enabled &&
      certificate?.boundary === boundary &&
      certificate.query === query &&
      certificate.authority === captureDeviceReadAuthority() &&
      query?.state.status === "success" &&
      data === query.state.data &&
      !!data &&
      typeof data === "object" &&
      "userId" in data &&
      data.userId === userId
    );
  }, [client, hash, enabled, boundary, userId]);
  const confirmed =
    enabled &&
    same &&
    accepted?.boundary === boundary &&
    accepted.query === client.getQueryCache().get(hash) &&
    accepted.authority === captureDeviceReadAuthority() &&
    accepted.data === overview.data &&
    overview.isSuccess &&
    !overview.error &&
    overview.data?.userId === userId;
  return { confirmed, isCurrent };
}
