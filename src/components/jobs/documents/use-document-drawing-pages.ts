"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, type RouterOutputs } from "~/trpc/react";
import {
  captureDeviceReadAuthority,
  isDeviceReadDenial,
  reportDeviceReadDenial,
} from "~/lib/device-query-cache";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { useDrawingAccount } from "../DrawingAccountProvider";

type Pages = RouterOutputs["drawingsWorkspace"]["openDocument"];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
/** Saved rows are real identities, never locally generated page records. */
export function validDocumentPages(
  value: unknown,
  jobId: string,
  versionId: string,
  organizationId: string,
): value is Pages {
  if (!Array.isArray(value) || !value.length || value.length > 2000)
    return false;
  const ids = new Set<string>();
  return value.every((item: unknown, index) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !uuid.test(row.id) || ids.has(row.id))
      return false;
    ids.add(row.id);
    return (
      row.jobId === jobId &&
      row.documentVersionId === versionId &&
      row.organizationId === organizationId &&
      typeof row.setId === "string" &&
      uuid.test(row.setId) &&
      typeof row.name === "string" &&
      row.name.length > 0 &&
      typeof row.width === "number" &&
      Number.isFinite(row.width) &&
      row.width > 0 &&
      typeof row.height === "number" &&
      Number.isFinite(row.height) &&
      row.height > 0 &&
      row.sortOrder === index + 1 &&
      row.imageUrl ===
        `/api/job-documents/pages/${versionId}/${index + 1}?jobId=${jobId}`
    );
  });
}
type Owner = {
  scope: string;
  authority: ReturnType<typeof captureDeviceReadAuthority>;
  active: boolean;
  denied: boolean;
  pending: boolean;
};
type State = {
  scope: string;
  data?: Pages;
  accepted: boolean;
  pending: boolean;
  error: Error | null;
  denied: boolean;
};
/** Device-first only for the selected, previously saved document version. */
export function useDocumentDrawingPages(jobId: string, versionId: string) {
  const account = useDrawingAccount();
  const online = useOnlineStatus();
  const { mutateAsync } = api.drawingsWorkspace.openDocument.useMutation({
    networkMode: "always",
    retry: false,
  });
  const scope = `${account?.accountKey ?? ""}|${jobId}|${versionId}`;
  const owner = useRef<Owner | null>(null);
  const [state, setState] = useState<State>({
    scope,
    accepted: false,
    pending: false,
    error: null,
    denied: false,
  });
  const current = useCallback(
    (request: Owner) =>
      request.active &&
      !request.denied &&
      owner.current === request &&
      request.authority === captureDeviceReadAuthority(),
    [],
  );
  const open = useCallback(
    async (request: Owner) => {
      if (!account?.organizationId || !current(request) || request.pending)
        return;
      if (!navigator.onLine) return;
      request.pending = true;
      setState((previous) => ({
        scope,
        data: previous.scope === scope ? previous.data : undefined,
        accepted: previous.scope === scope && previous.accepted,
        pending: true,
        error: null,
        denied: false,
      }));
      try {
        const pages = await mutateAsync({ jobId, versionId });
        if (!current(request)) return;
        if (
          !validDocumentPages(pages, jobId, versionId, account.organizationId)
        )
          throw Error(
            "Could not validate this document's saved pages. Retry opening it.",
          );
        setState({
          scope,
          data: pages,
          accepted: true,
          pending: false,
          error: null,
          denied: false,
        });
        if (current(request))
          void account.store
            ?.saveSnapshot(`document-sheets:${versionId}`, pages)
            .catch(() => undefined);
      } catch (error) {
        if (!current(request)) return;
        const failure =
          error instanceof Error
            ? error
            : Error("Could not open this document.");
        if (isDeviceReadDenial(error)) {
          request.denied = true;
          setState({
            scope,
            accepted: false,
            pending: false,
            error: failure,
            denied: true,
          });
          reportDeviceReadDenial(
            "drawingsWorkspace.openDocument",
            "mutation",
            error,
            request.authority,
          );
        } else
          setState((previous) => ({
            ...previous,
            pending: false,
            error: failure,
          }));
      } finally {
        request.pending = false;
      }
    },
    [account, current, jobId, versionId, mutateAsync, scope],
  );
  useLayoutEffect(() => {
    const request: Owner = {
      scope,
      authority: captureDeviceReadAuthority(),
      active: true,
      denied: false,
      pending: false,
    };
    owner.current = request;
    return () => {
      request.active = false;
    };
  }, [scope]);
  useEffect(() => {
    const request = owner.current;
    if (request?.scope !== scope || !current(request)) return;
    if (account?.organizationId) {
      void account.store
        ?.readSnapshot<unknown>(`document-sheets:${versionId}`)
        .then((saved) => {
          if (
            current(request) &&
            validDocumentPages(saved, jobId, versionId, account.organizationId)
          )
            setState((previous) =>
              previous.scope === scope && previous.accepted
                ? previous
                : {
                    scope,
                    data: saved,
                    accepted: false,
                    pending: request.pending,
                    error: previous.scope === scope ? previous.error : null,
                    denied: false,
                  },
            );
        })
        .catch(() => undefined);
      void open(request);
    }
    return () => {
      request.active = false;
    };
  }, [account, current, open, scope, jobId, versionId]);
  // Revalidate the currently opened read on an actual reconnect. This is not a
  // queued write replay; failures while still online require explicit retry.
  useEffect(() => {
    if (online && owner.current) void open(owner.current);
  }, [online, open]);
  const retry = () => {
    if (owner.current) void open(owner.current);
  };
  const persist = async () => {
    const request = owner.current;
    if (
      request &&
      current(request) &&
      state.scope === scope &&
      state.data &&
      account?.organizationId &&
      validDocumentPages(state.data, jobId, versionId, account.organizationId)
    )
      await account.store?.saveSnapshot(
        `document-sheets:${versionId}`,
        state.data,
      );
  };
  return {
    online,
    data: state.scope === scope && !state.denied ? state.data : undefined,
    error: state.scope === scope ? state.error : null,
    isPending: state.scope === scope && state.pending,
    denied: state.scope === scope && state.denied,
    retry,
    persist,
  };
}
