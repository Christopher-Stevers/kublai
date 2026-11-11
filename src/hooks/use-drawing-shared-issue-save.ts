"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api } from "~/trpc/react";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import type {
  DrawingSave,
  DrawingEntity,
  DrawingWorkspace,
} from "~/lib/drawing-workspace";
type Issue = Extract<DrawingSave, { kind: "issue" }>;
export function isExistingOwnSharedIssue(
  input: DrawingSave,
  workspace: DrawingWorkspace | undefined,
): input is Issue {
  const previous = workspace?.entities.find((item) => item.id === input.id);
  return (
    input.kind === "issue" &&
    input.visibility === "published" &&
    input.expectedRevision > 0 &&
    input.sheetId === workspace?.sheetId &&
    previous?.kind === "issue" &&
    previous.visibility === "published" &&
    previous.authorId === workspace?.actor.id
  );
}
type Owner = {
  account: object;
  key: string;
  authority: object | null;
  accountEpoch: number;
  viewEpoch: number;
};
type Attempt = { owner: Owner; input: Issue; token: symbol };
type Block = { attempt: Attempt; checked: boolean; checkedAt?: number };
const uncertainMessage =
  "Issue save could not be confirmed. Check the latest issue before another save; your draft stays here.";
export function useDrawingSharedIssueSave(options: {
  sheetId: string;
  jobId: string;
  omitHyperlinks: boolean;
  viewScope: string;
  viewEntityId: string | null;
  workspace: DrawingWorkspace | undefined;
  canStart: () => boolean;
  onAccepted: (entity: DrawingEntity) => void;
  onFailure: (draft: Issue, message: string) => void;
  onMessage: (message: string) => void;
}) {
  const account = useDrawingAccount(),
    client = useQueryClient(),
    utils = api.useUtils();
  const current = useRef({
    options,
    account,
    accountEpoch: 0,
    viewEpoch: 0,
    mounted: false,
  });
  const requests = useRef(new Set<Attempt>()),
    blocks = useRef(new Map<string, Block>()),
    reads = useRef(new Set<AbortController>());
  const [pending, setPending] = useState<Attempt | null>(null),
    [blockedById, setBlockedById] = useState<Record<string, Block>>({}),
    [reading, setReading] = useState<Attempt | null>(null);
  const blocked = options.viewEntityId
    ? blockedById[options.viewEntityId]
    : undefined;
  const readFlight = useRef<Attempt | null>(null);
  useLayoutEffect(() => {
    const state = current.current;
    if (state.account !== account) {
      state.accountEpoch++;
      for (const read of reads.current) read.abort();
    }
    if (
      state.options.viewScope !== options.viewScope ||
      state.options.sheetId !== options.sheetId
    ) {
      state.viewEpoch++;
      for (const read of reads.current) read.abort();
    }
    state.account = account;
    state.options = options;
  });
  useLayoutEffect(() => {
    const state = current.current;
    state.mounted = true;
    const activeReads = reads.current;
    return () => {
      state.mounted = false;
      state.viewEpoch++;
      for (const read of activeReads) read.abort();
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
  const keyFor = (sheetId: string, omit: boolean) =>
    getQueryKey(
      api.drawingsWorkspace.get,
      { sheetId, ...(omit ? { omitHyperlinks: true } : {}) },
      "query",
    );
  const refresh = (attempt: Attempt) => {
    if (!ownsAccount(attempt.owner)) return;
    for (const work of [
      () =>
        utils.drawingsWorkspace.get.invalidate({
          sheetId: attempt.input.sheetId,
        }),
      () => utils.drawingsWorkspace.list.invalidate({ jobId: options.jobId }),
    ])
      try {
        void work().catch(() => undefined);
      } catch {
        /* Accepted write remains accepted. */
      }
  };
  const trySave = (input: DrawingSave): Promise<boolean> | null => {
    const active = [...requests.current].find(
      (row) => row.input.id === input.id && ownsAccount(row.owner),
    );
    if (active) return Promise.resolve(false);
    const block = blocks.current.get(input.id);
    if (
      block &&
      ownsAccount(block.attempt.owner) &&
      (!block.checked || block.checkedAt === current.current.viewEpoch)
    ) {
      options.onMessage(
        "Check the latest issue, then close and reopen its editor before another save.",
      );
      return Promise.resolve(false);
    }
    if (!isExistingOwnSharedIssue(input, options.workspace)) return null;
    if (
      !account?.accountKey ||
      account.userId !== options.workspace?.actor.id ||
      !navigator.onLine ||
      !options.canStart()
    ) {
      options.onMessage(
        "Reconnect and check drawing access before saving this shared issue.",
      );
      return Promise.resolve(false);
    }
    const owner: Owner = {
      account,
      key: account.accountKey,
      authority: captureDeviceReadAuthority(),
      accountEpoch: current.current.accountEpoch,
      viewEpoch: current.current.viewEpoch,
    };
    const attempt: Attempt = {
      owner,
      input: { ...input, expectedUserId: account.userId },
      token: Symbol(),
    };
    requests.current.add(attempt);
    setPending(attempt);
    return Promise.resolve()
      .then(async () => {
        if (
          !ownsView(owner) ||
          !navigator.onLine ||
          !current.current.options.canStart()
        )
          throw Object.assign(
            Error("Reconnect and check drawing access before saving."),
            { notDispatched: true },
          );
        return utils.client.drawingsWorkspace.save.mutate({
          ...attempt.input,
          expectedAccountKey: owner.key,
        });
      })
      .then((entity) => {
        if (
          entity.id !== input.id ||
          entity.sheetId !== input.sheetId ||
          entity.kind !== "issue" ||
          entity.authorId !== account.userId ||
          entity.revision <= input.expectedRevision
        )
          throw Error("Issue acknowledgement could not be verified.");
        try {
          if (ownsAccount(owner)) {
            const key = keyFor(input.sheetId, options.omitHyperlinks),
              previous = client.getQueryData<DrawingWorkspace>(key);
            const newer =
              (previous?.entities.find((row) => row.id === input.id)
                ?.revision ?? -1) > entity.revision;
            if (!newer)
              client.setQueryData<DrawingWorkspace>(key, (old) =>
                old
                  ? {
                      ...old,
                      entities: old.entities.map((row) =>
                        row.id === entity.id && row.revision <= entity.revision
                          ? entity
                          : row,
                      ),
                    }
                  : old,
              );
            if (ownsView(owner)) current.current.options.onAccepted(entity);
          }
        } catch {
          if (ownsView(owner))
            current.current.options.onMessage(
              "Issue saved. Refresh to check the latest issue.",
            );
        }
        refresh(attempt);
        return true;
      })
      .catch((reason: unknown) => {
        if (!ownsView(owner)) return false;
        const code =
          reason && typeof reason === "object" && "data" in reason
            ? (reason.data as { code?: string } | undefined)?.code
            : undefined;
        const refused =
          Boolean(
            reason && typeof reason === "object" && "notDispatched" in reason,
          ) ||
          [
            "FORBIDDEN",
            "UNAUTHORIZED",
            "BAD_REQUEST",
            "CONFLICT",
            "NOT_FOUND",
          ].includes(code ?? "");
        if (!refused) {
          const block = { attempt, checked: false };
          blocks.current.set(input.id, block);
          setBlockedById((old) => ({ ...old, [input.id]: block }));
        }
        current.current.options.onFailure(
          attempt.input,
          refused && reason instanceof Error
            ? reason.message
            : uncertainMessage,
        );
        refresh(attempt);
        return false;
      })
      .finally(() => {
        requests.current.delete(attempt);
        setPending((old) => (old?.token === attempt.token ? null : old));
      });
  };
  const recover = async () => {
    const block = blocked;
    if (
      !block ||
      !ownsAccount(block.attempt.owner) ||
      options.viewEntityId !== block.attempt.input.id ||
      !navigator.onLine ||
      !options.canStart() ||
      (readFlight.current !== null &&
        ownsView(readFlight.current.owner) &&
        readFlight.current.input.id === block.attempt.input.id)
    )
      return;
    const readAttempt: Attempt = {
      ...block.attempt,
      token: Symbol(),
      owner: { ...block.attempt.owner, viewEpoch: current.current.viewEpoch },
    };
    const controller = new AbortController();
    reads.current.add(controller);
    readFlight.current = readAttempt;
    setReading(readAttempt);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const workspace = await utils.client.drawingsWorkspace.get.query(
        {
          sheetId: block.attempt.input.sheetId,
          ...(options.omitHyperlinks ? { omitHyperlinks: true } : {}),
        },
        { signal: controller.signal },
      );
      if (
        !ownsView(readAttempt.owner) ||
        controller.signal.aborted ||
        blocks.current.get(block.attempt.input.id) !== block
      )
        return;
      if (
        workspace.sheetId !== block.attempt.input.sheetId ||
        workspace.actor.id !== account?.userId
      )
        throw Error("Drawing identity changed.");
      const key = keyFor(workspace.sheetId, options.omitHyperlinks);
      const latest = workspace.entities.find(
        (row) => row.id === block.attempt.input.id,
      );
      client.setQueryData<DrawingWorkspace>(key, (old) =>
        old
          ? {
              ...old,
              entities: old.entities.flatMap((row) =>
                row.id !== block.attempt.input.id
                  ? [row]
                  : latest
                    ? [row.revision > latest.revision ? row : latest]
                    : // Workspace revision is an optional content hash, never
                      // an ordering certificate for deleting a cached entity.
                      [row],
              ),
            }
          : old,
      );
      if (!latest) {
        current.current.options.onMessage(
          "The latest issue was not returned. Your draft is kept; refresh the workspace to check access before saving.",
        );
        return;
      }
      const checked = {
        ...block,
        checked: true,
        checkedAt: current.current.viewEpoch,
      };
      blocks.current.set(block.attempt.input.id, checked);
      setBlockedById((old) => ({ ...old, [block.attempt.input.id]: checked }));
      options.onMessage(
        "Latest issue loaded. Your draft is kept; close and reopen the editor to review before saving.",
      );
    } catch {
      if (ownsView(readAttempt.owner))
        current.current.options.onMessage(
          "Could not check the latest issue. Your draft is kept; no save was retried.",
        );
    } finally {
      clearTimeout(timer);
      reads.current.delete(controller);
      if (readFlight.current === readAttempt) readFlight.current = null;
      setReading((old) => (old === readAttempt ? null : old));
    }
  };
  return {
    trySave,
    recover,
    isPending: pending !== null && ownsAccount(pending.owner),
    needsRecovery:
      blocked !== undefined &&
      ownsAccount(blocked.attempt.owner) &&
      blocked.attempt.input.id === options.viewEntityId &&
      (!blocked.checked || blocked.checkedAt === current.current.viewEpoch),
    checking: reading !== null && ownsView(reading.owner),
  };
}
