"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import { requestCatalogueReplicachePull } from "~/lib/replicache-catalogue";

type Input = RouterInputs["catalogue"]["createPart"];
type Result = RouterOutputs["catalogue"]["createPart"];
type Owner = {
  account: ReturnType<typeof useDrawingAccount>;
  authority: ReturnType<typeof captureDeviceReadAuthority>;
  accountEpoch: number;
  viewEpoch: number;
};
export const unconfirmedPartCreation =
  "Part creation could not be confirmed. Check the catalogue before creating it again.";

/** One explicit request, never an offline queue or an invented catalogue ID. */
export function useCreateCataloguePart(options: {
  enabled: boolean;
  scope: string;
  onCreated: (part: Result) => void;
}) {
  const account = useDrawingAccount();
  const utils = api.useUtils();
  const current = useRef({
    account,
    accountEpoch: 0,
    viewEpoch: 0,
    mounted: false,
    options,
  });
  const flight = useRef<Owner | null>(null);
  const [pending, setPending] = useState<Owner | null>(null);
  const [failure, setFailure] = useState<{
    owner: Owner;
    message: string;
  } | null>(null);
  useLayoutEffect(() => {
    const state = current.current;
    if (state.account !== account) state.accountEpoch++;
    // Availability can change while the same form is open. A real ACK still
    // belongs to that form; only identity/lifecycle changes invalidate it.
    if (state.options.scope !== options.scope) state.viewEpoch++;
    state.account = account;
    state.options = options;
  });
  useLayoutEffect(() => {
    const state = current.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
      state.viewEpoch++;
    };
  }, []);
  const ownsAccount = (owner: Owner) =>
    owner.account === current.current.account &&
    owner.accountEpoch === current.current.accountEpoch &&
    owner.authority === captureDeviceReadAuthority();
  const ownsView = (owner: Owner) =>
    ownsAccount(owner) &&
    current.current.mounted &&
    owner.viewEpoch === current.current.viewEpoch;
  const makeOwner = (): Owner => ({
    account: current.current.account,
    accountEpoch: current.current.accountEpoch,
    viewEpoch: current.current.viewEpoch,
    authority: captureDeviceReadAuthority(),
  });

  return {
    isPending: pending !== null && ownsAccount(pending),
    error: failure && ownsView(failure.owner) ? failure.message : null,
    hasPending: () => flight.current !== null && ownsAccount(flight.current),
    create: async (input: Input) => {
      if (flight.current && ownsAccount(flight.current)) return false;
      const owner = makeOwner();
      if (
        !owner.account?.accountKey ||
        !current.current.mounted ||
        !current.current.options.enabled ||
        !navigator.onLine
      ) {
        setFailure({
          owner,
          message: "Reconnect and reopen this form before creating a part.",
        });
        return false;
      }
      flight.current = owner;
      setPending(owner);
      setFailure(null);
      let result: Result;
      try {
        // Direct tRPC dispatch has no TanStack paused-mutation replay or retry.
        result = await utils.client.catalogue.createPart.mutate({
          ...input,
          expectedAccountKey: owner.account.accountKey,
        });
      } catch (error) {
        if (ownsView(owner)) {
          const code =
            error && typeof error === "object" && "data" in error
              ? (error.data as { code?: string } | undefined)?.code
              : undefined;
          const knownRefusal =
            code &&
            ["BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "CONFLICT"].includes(
              code,
            );
          setFailure({
            owner,
            message:
              knownRefusal && error instanceof Error
                ? error.message
                : unconfirmedPartCreation,
          });
        }
        return false;
      } finally {
        if (flight.current === owner) flight.current = null;
        if (current.current.mounted)
          setPending((old) => (old === owner ? null : old));
        // A lost ACK can still have created the part. Reconcile without replay.
        if (ownsAccount(owner)) {
          const refresh = (work: () => unknown) => {
            try {
              void Promise.resolve(work()).catch(() => undefined);
            } catch {
              /* Real ACK remains authoritative. */
            }
          };
          refresh(() => requestCatalogueReplicachePull(0));
          refresh(() => utils.catalogue.searchParts.invalidate());
          refresh(() => utils.catalogue.getPartWizardSummary.invalidate());
          refresh(() => utils.catalogue.getPart.invalidate());
        }
      }
      if (ownsView(owner)) current.current.options.onCreated(result);
      return true;
    },
  };
}
