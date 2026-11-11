"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs } from "~/trpc/react";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import type {
  DrawingMetadata,
  DrawingWorkspace,
} from "~/lib/drawing-workspace";
import type {
  ScaleSaveAcknowledgement,
  ScaleSaveRefusal,
} from "~/components/jobs/useDrawingEditor";

type Owner = {
  accountKey: string;
  binding: object;
  epoch: number;
  authority: object | null;
  scope: string;
  uiEpoch: number;
  sheetId: string;
  jobId: string;
  sourceId: string;
};
type Request = {
  owner: Owner;
  token: symbol;
  input: RouterInputs["drawingsWorkspace"]["setScale"];
};
class ScaleNotDispatched extends Error {}
function refusalMessage(reason: unknown): string {
  if (reason instanceof ScaleNotDispatched) return reason.message;
  const data =
    reason && typeof reason === "object" && "data" in reason
      ? reason.data
      : null;
  const code =
    data && typeof data === "object" && "code" in data ? data.code : null;
  if (
    typeof code === "string" &&
    [
      "FORBIDDEN",
      "UNAUTHORIZED",
      "CONFLICT",
      "BAD_REQUEST",
      "NOT_FOUND",
    ].includes(code)
  )
    return reason instanceof Error
      ? reason.message
      : "Scale was refused. Check access to this drawing before trying again.";
  return "Scale could not be confirmed. Refresh to check the latest scale before retrying.";
}
/** Shared engineering metadata is never optimistic or queued. The returned ACK
 * distinguishes server acceptance from permission to finish an old viewer. */
export function useDrawingScaleSave(options: {
  sheetId: string;
  jobId: string;
  sourceId: string;
  omitHyperlinks: boolean;
  canStart: () => boolean;
  currentAcceptedRevision: () => number;
  onAccepted: (metadata: DrawingMetadata) => void;
  onError: (reason: unknown) => void;
}) {
  const account = useDrawingAccount(),
    client = useQueryClient(),
    utils = api.useUtils();
  const scope = JSON.stringify([
    options.jobId,
    options.sheetId,
    options.sourceId,
    options.omitHyperlinks,
  ]);
  const current = useRef({
    binding: null as object | null,
    accountKey: "",
    epoch: 0,
    scope: "",
    uiEpoch: 0,
    mounted: false,
    options,
  });
  const requests = useRef(new Set<Request>());
  const [intent, setIntent] = useState<Request | null>(null);
  useLayoutEffect(() => {
    if (current.current.binding !== account) current.current.epoch++;
    if (current.current.scope !== scope) current.current.uiEpoch++;
    current.current.binding = account;
    current.current.accountKey = account?.accountKey ?? "";
    current.current.scope = scope;
    current.current.options = options;
  });
  useLayoutEffect(() => {
    current.current.mounted = true;
    const state = current.current;
    return () => {
      state.mounted = false;
      state.uiEpoch++;
    };
  }, []);
  const sameAccount = (owner: Owner) =>
    owner.epoch === current.current.epoch &&
    owner.accountKey === current.current.accountKey &&
    owner.authority === captureDeviceReadAuthority();
  const ownsUI = (owner: Owner) =>
    sameAccount(owner) &&
    current.current.mounted &&
    owner.scope === current.current.scope &&
    owner.uiEpoch === current.current.uiEpoch;
  const mutation = useMutation({
    mutationKey: [["drawingsWorkspace", "setScale"]],
    networkMode: "always",
    retry: false,
    mutationFn: async (request: Request) => {
      if (
        !navigator.onLine ||
        !ownsUI(request.owner) ||
        !current.current.options.canStart()
      )
        throw new ScaleNotDispatched(
          "Reconnect and check current drawing access before saving scale.",
        );
      const next = await utils.client.drawingsWorkspace.setScale.mutate(
        request.input,
      );
      if (
        !Number.isInteger(next.revision) ||
        next.revision < 0 ||
        typeof next.currentSourceSheetId !== "string"
      )
        throw Error(
          "Scale acknowledgement was incomplete. Refresh to check the saved scale.",
        );
      return next;
    },
  });
  return {
    isPending:
      intent !== null &&
      intent.owner.binding === account &&
      intent.owner.scope === scope &&
      intent.owner.authority === captureDeviceReadAuthority(),
    save: (
      scale: DrawingMetadata["scale"],
    ): Promise<ScaleSaveAcknowledgement | ScaleSaveRefusal | false> => {
      const owner: Owner = {
        accountKey: account?.accountKey ?? "",
        binding: account ?? {},
        epoch: current.current.epoch,
        authority: captureDeviceReadAuthority(),
        scope,
        uiEpoch: current.current.uiEpoch,
        sheetId: options.sheetId,
        jobId: options.jobId,
        sourceId: options.sourceId,
      };
      if (
        [...requests.current].some(
          (row) =>
            sameAccount(row.owner) && row.owner.sheetId === owner.sheetId,
        )
      )
        return Promise.resolve(false);
      if (
        !account ||
        !navigator.onLine ||
        !ownsUI(owner) ||
        !current.current.options.canStart()
      ) {
        if (ownsUI(owner))
          current.current.options.onError(
            Error(
              "Reconnect and check current drawing access before saving scale.",
            ),
          );
        return Promise.resolve(false);
      }
      const request: Request = {
        owner,
        token: Symbol(),
        input: {
          sheetId: owner.sheetId,
          scale,
          expectedAccountKey: owner.accountKey,
        },
      };
      requests.current.add(request);
      setIntent(request);
      return mutation
        .mutateAsync(request)
        .then((next) => {
          let applyToView = false;
          let acceptedScale = next.scale;
          if (sameAccount(owner)) {
            try {
              // Cancellation starts synchronously; its promise and authoritative
              // refresh must not hold a confirmed write's UI lock open.
              void utils.drawingsWorkspace.get
                .cancel({ sheetId: owner.sheetId })
                .catch(() => undefined);
              const input = {
                sheetId: owner.sheetId,
                ...(options.omitHyperlinks ? { omitHyperlinks: true } : {}),
              };
              const key = getQueryKey(
                api.drawingsWorkspace.get,
                input,
                "query",
              );
              const old = client.getQueryData<DrawingWorkspace>(key);
              const localRevision =
                current.current.options.sheetId === owner.sheetId &&
                current.current.options.jobId === owner.jobId
                  ? current.current.options.currentAcceptedRevision()
                  : -1;
              const newer =
                Math.max(old?.metadata.revision ?? -1, localRevision) >
                next.revision;
              if (!newer)
                utils.drawingsWorkspace.get.setData(input, (previous) =>
                  sameAccount(owner) &&
                  previous &&
                  previous.metadata.revision <= next.revision
                    ? { ...previous, metadata: next }
                    : previous,
                );
              const canonical =
                client.getQueryData<DrawingWorkspace>(key)?.metadata ?? next;
              acceptedScale = canonical.scale;
              applyToView =
                ownsUI(owner) &&
                !newer &&
                canonical.revision === next.revision &&
                canonical.currentSourceSheetId === owner.sourceId;
              if (ownsUI(owner) && !newer)
                current.current.options.onAccepted(canonical);
            } catch {
              if (ownsUI(owner)) {
                try {
                  current.current.options.onError(
                    Error(
                      "Scale saved. Refresh the drawing to check the latest calibration.",
                    ),
                  );
                } catch {
                  /* ACK remains accepted. */
                }
              }
            }
            // Same-account reconciliation survives UI hiding/removal, but these
            // calls are never made through a replacement actor's live context.
            try {
              void utils.drawingsWorkspace.get
                .invalidate({ sheetId: owner.sheetId })
                .catch(() => undefined);
            } catch {
              /* Read catch-up is best effort. */
            }
            try {
              void utils.drawingsWorkspace.list
                .invalidate({ jobId: owner.jobId })
                .catch(() => undefined);
            } catch {
              /* Read catch-up is best effort. */
            }
          }
          return { accepted: true as const, scale: acceptedScale, applyToView };
        })
        .catch((reason: unknown) => {
          const message = refusalMessage(reason);
          if (ownsUI(owner)) {
            try {
              current.current.options.onError(new Error(message));
            } catch {
              /* Failure/unknown outcome remains unconfirmed. */
            }
          }
          return { accepted: false as const, message };
        })
        .finally(() => {
          requests.current.delete(request);
          setIntent((old) => (old?.token === request.token ? null : old));
        });
    },
  };
}
