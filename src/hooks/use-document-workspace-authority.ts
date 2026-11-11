"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { hashKey, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import type { DrawingWorkspace } from "~/lib/drawing-workspace";
/** A real validator response, not hydration/manual updates, establishes online
 * document editing authority. Activity cleanup revokes the certificate. */
export function useDocumentWorkspaceAuthority(
  key: QueryKey,
  enabled: boolean,
  accountKey: string,
  userId: string,
  sheetId: string,
  query: { data?: DrawingWorkspace; error: unknown },
) {
  const client = useQueryClient(),
    hash = hashKey(key);
  const [boundary, setBoundary] = useState(() => ({
    hash,
    enabled,
    accountKey,
    userId,
    sheetId,
  }));
  const same =
    boundary.hash === hash &&
    boundary.enabled === enabled &&
    boundary.accountKey === accountKey &&
    boundary.userId === userId &&
    boundary.sheetId === sheetId;
  if (!same) setBoundary({ hash, enabled, accountKey, userId, sheetId });
  type Certificate = {
    boundary: typeof boundary;
    query: object;
    data: DrawingWorkspace;
    authority: ReturnType<typeof captureDeviceReadAuthority>;
  };
  const [accepted, setAccepted] = useState<Certificate | null>(null);
  const current = useRef<Certificate | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const authority = captureDeviceReadAuthority();
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (
        event.type !== "updated" ||
        event.query.queryHash !== hash ||
        event.action.type !== "success" ||
        client.getQueryCache().get(hash) !== event.query ||
        authority !== captureDeviceReadAuthority()
      )
        return;
      const value: unknown = event.action.data;
      if (
        event.action.manual ||
        !value ||
        typeof value !== "object" ||
        !("sheetId" in value) ||
        value.sheetId !== sheetId ||
        !("actor" in value) ||
        !value.actor ||
        typeof value.actor !== "object" ||
        !("id" in value.actor) ||
        value.actor.id !== userId
      ) {
        current.current = null;
        setAccepted(null);
        return;
      }
      const certificate = {
        boundary,
        query: event.query,
        data: value as DrawingWorkspace,
        authority,
      };
      current.current = certificate;
      setAccepted(certificate);
    });
    return () => {
      current.current = null;
      unsubscribe();
      setAccepted(null);
    };
  }, [client, hash, enabled, boundary, sheetId, userId]);
  const isCurrent = useCallback(() => {
    const certificate = current.current,
      actual = client.getQueryCache().get(hash);
    return Boolean(
      enabled &&
      certificate?.boundary === boundary &&
      certificate.query === actual &&
      certificate.authority === captureDeviceReadAuthority() &&
      actual?.state.status === "success" &&
      certificate.data === actual.state.data &&
      certificate.data.actor.id === userId &&
      certificate.data.sheetId === sheetId,
    );
  }, [client, hash, enabled, boundary, userId, sheetId]);
  const confirmed = Boolean(
    enabled &&
    same &&
    accepted?.boundary === boundary &&
    accepted.query === client.getQueryCache().get(hash) &&
    accepted.authority === captureDeviceReadAuthority() &&
    accepted.data === query.data &&
    !query.error &&
    query.data?.actor.id === userId &&
    query.data.sheetId === sheetId,
  );
  return { confirmed, isCurrent };
}
