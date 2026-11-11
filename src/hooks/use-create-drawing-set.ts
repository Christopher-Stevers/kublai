"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import { useInstantMutation } from "./use-instant-mutation";

type Input = RouterInputs["drawings"]["createSet"];
type Result = RouterOutputs["drawings"]["createSet"];
type Owner = {
  accountKey: string;
  binding: object;
  accountEpoch: number;
  authority: ReturnType<typeof captureDeviceReadAuthority>;
  scope: string;
  uiEpoch: number;
  jobId: string;
  parentId: string | null;
};
type Request = { input: Input; owner: Owner; token: symbol };
const failureText =
  "Folder creation could not be confirmed; check the folders before retrying.";

/** Ephemeral creation intent only: no invented folder, cached capability or
 * second offline queue. A real server ID is required before navigation. */
export function useCreateDrawingSet(options: {
  jobId: string;
  parentId: string | null;
  viewId: string | null;
  enabled: boolean;
  onStart: () => void;
  onRefused: (name: string) => void;
  onCreated: (id: string) => void;
}) {
  const account = useDrawingAccount();
  const utils = api.useUtils();
  const scope = JSON.stringify([
    options.jobId,
    options.parentId,
    options.viewId,
  ]);
  const current = useRef({
    accountKey: "",
    binding: null as object | null,
    accountEpoch: 0,
    scope: "",
    uiEpoch: 0,
    mounted: false,
  });
  const requests = useRef(new Set<Request>());
  const [intent, setIntent] = useState<Request | null>(null);
  const [failure, setFailure] = useState<{
    scope: string;
    accountKey: string;
    authority: ReturnType<typeof captureDeviceReadAuthority>;
  } | null>(null);
  useLayoutEffect(() => {
    const next = account?.accountKey ?? "";
    if (
      current.current.accountKey !== next ||
      current.current.binding !== account
    )
      current.current.accountEpoch++;
    if (current.current.scope !== scope) current.current.uiEpoch++;
    current.current.accountKey = next;
    current.current.binding = account;
    current.current.scope = scope;
  }, [account, scope]);
  useLayoutEffect(() => {
    current.current.mounted = true;
    const lifecycle = current.current;
    return () => {
      lifecycle.mounted = false;
      lifecycle.uiEpoch++;
    };
  }, []);
  const ownsAccount = (owner: Owner) =>
    owner.accountKey === current.current.accountKey &&
    owner.accountEpoch === current.current.accountEpoch &&
    owner.authority === captureDeviceReadAuthority();
  const ownsUI = (owner: Owner) =>
    ownsAccount(owner) &&
    current.current.mounted &&
    owner.scope === current.current.scope &&
    owner.uiEpoch === current.current.uiEpoch;
  const mutation = useInstantMutation<Result, Request>({
    mutationKey: [["drawings", "createSet"]],
    mutationFn: async ({ input, owner }) => {
      if (!ownsUI(owner))
        throw Error(
          "Your drawing workspace changed before this request was sent.",
        );
      const result = await utils.client.drawings.createSet.mutate(input);
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result.id))
        throw Error("Refresh the folders to check this creation.");
      return result;
    },
    optimistic: (request) => {
      if (
        !options.enabled ||
        !request.owner.accountKey ||
        !ownsUI(request.owner)
      )
        throw Error(
          "Reconnect and reopen this folder before creating a folder.",
        );
      if (
        [...requests.current].some(
          (row) => ownsAccount(row.owner) && row.owner.jobId === options.jobId,
        )
      )
        throw Error("A folder is still being created.");
      requests.current.add(request);
      setFailure(null);
      setIntent(request);
      try {
        options.onStart();
      } catch (error) {
        requests.current.delete(request);
        setIntent((old) => (old?.token === request.token ? null : old));
        throw error;
      }
      return {
        rollback: () => {
          if (ownsUI(request.owner)) options.onRefused(request.input.name);
        },
        commit: (result) => {
          if (ownsUI(request.owner)) options.onCreated(result.id);
        },
        finish: () => {
          requests.current.delete(request);
          setIntent((old) => (old?.token === request.token ? null : old));
        },
      };
    },
    onError: (_error, { owner }) => {
      if (ownsUI(owner))
        setFailure({
          scope: owner.scope,
          accountKey: owner.accountKey,
          authority: owner.authority,
        });
    },
    onSettled: ({ owner }) => {
      // Accepted or uncertain requests still reconcile for this account after
      // closing/switching the view. Never refresh a replacement account.
      if (!ownsAccount(owner)) return;
      void utils.drawings.listSets.invalidate({ jobId: owner.jobId });
      void utils.drawingsWorkspace.list.invalidate({ jobId: owner.jobId });
      if (owner.parentId)
        void utils.drawings.getSet.invalidate({ setId: owner.parentId });
    },
    errorMessage: failureText,
  });
  const isPending =
    intent !== null &&
    intent.owner.accountKey === account?.accountKey &&
    intent.owner.binding === account &&
    intent.owner.authority === captureDeviceReadAuthority() &&
    intent.owner.jobId === options.jobId;
  return {
    isPending,
    pendingName: isPending ? intent.input.name : null,
    error:
      failure?.scope === scope &&
      failure.accountKey === account?.accountKey &&
      failure.authority === captureDeviceReadAuthority()
        ? failureText
        : null,
    create: (name: string) => {
      const trimmed = name.trim();
      if (
        [...requests.current].some(
          (row) => ownsAccount(row.owner) && row.owner.jobId === options.jobId,
        )
      )
        return false;
      if (
        !trimmed ||
        !options.enabled ||
        !navigator.onLine ||
        !account?.accountKey ||
        !current.current.mounted
      ) {
        setFailure({
          scope,
          accountKey: account?.accountKey ?? "",
          authority: captureDeviceReadAuthority(),
        });
        return false;
      }
      const owner: Owner = {
        accountKey: account.accountKey,
        binding: account,
        accountEpoch: current.current.accountEpoch,
        authority: captureDeviceReadAuthority(),
        scope,
        uiEpoch: current.current.uiEpoch,
        jobId: options.jobId,
        parentId: options.parentId,
      };
      mutation.mutate({
        input: {
          jobId: owner.jobId,
          name: trimmed,
          ...(owner.parentId ? { parentId: owner.parentId } : {}),
          expectedAccountKey: owner.accountKey,
        },
        owner,
        token: Symbol(),
      });
      return true;
    },
  };
}
