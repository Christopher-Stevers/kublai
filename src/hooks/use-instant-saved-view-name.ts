"use client";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { notify } from "~/components/ui/app-dialogs";
import { api } from "~/trpc/react";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { captureDeviceReadAuthority } from "~/lib/device-query-cache";
import {
  isInstantQueryPending,
  beginInstantQueryUpdate,
} from "~/lib/instant-query-update";
import {
  drawingSaveSchema,
  type DrawingSave,
  type DrawingEntity,
  type DrawingWorkspace,
} from "~/lib/drawing-workspace";
import { useInstantMutation } from "./use-instant-mutation";

type ViewEdit = Extract<DrawingSave, { kind: "view" }>;
export function eligibleSavedViewName(
  input: DrawingSave,
  workspace: DrawingWorkspace | undefined,
): input is ViewEdit {
  if (
    input.kind !== "view" ||
    input.visibility !== "private" ||
    input.expectedRevision <= 0 ||
    !workspace ||
    input.sheetId !== workspace?.sheetId
  )
    return false;
  const previous = workspace.entities.find((entity) => entity.id === input.id);
  return Boolean(
    previous?.kind === "view" &&
    previous.visibility === "private" &&
    previous.authorId === workspace.actor.id &&
    previous.revision === input.expectedRevision &&
    input.data.name.trim() &&
    input.data.name.trim() !== previous.data.name &&
    input.data.sourceSheetId === previous.data.sourceSheetId &&
    input.data.zoom === previous.data.zoom &&
    input.data.center.x === previous.data.center.x &&
    input.data.center.y === previous.data.center.y &&
    Object.keys(input.data).every((key) =>
      ["sourceSheetId", "name", "center", "zoom"].includes(key),
    ) &&
    Object.keys(input.data.center).every((key) => ["x", "y"].includes(key)),
  );
}
/** Ephemeral preview for an existing private view name; never queues an edit. */
export function useInstantSavedViewName(options: {
  sheetId: string;
  hyperlinksVisible: boolean;
  onStarted: (input: ViewEdit) => void;
  onRestore: (input: ViewEdit) => void;
}) {
  const account = useDrawingAccount(),
    client = useQueryClient(),
    utils = api.useUtils();
  const pending = useRef(new Set<{ id: string; scope: string }>());
  const scope = `${account?.accountKey ?? ""}|${options.sheetId}|${options.hyperlinksVisible}`;
  const current = useRef({
    scope,
    accountKey: account?.accountKey ?? "",
    generation: 0,
    mounted: false,
  });
  useLayoutEffect(() => {
    current.current.accountKey = account?.accountKey ?? "";
    if (current.current.scope !== scope) {
      current.current.scope = scope;
      current.current.generation++;
    }
  }, [scope, account?.accountKey]);
  useLayoutEffect(() => {
    current.current.mounted = true;
    const state = current.current;
    return () => {
      state.mounted = false;
    };
  }, []);
  type Owner = {
    scope: string;
    generation: number;
    authority: ReturnType<typeof captureDeviceReadAuthority>;
    accountKey: string;
    restored: boolean;
  };
  type Request = { input: ViewEdit; owner: Owner };
  const ownsCache = (owner: Owner) =>
    owner.accountKey === current.current.accountKey &&
    captureDeviceReadAuthority() === owner.authority;
  const owns = (owner: Owner) =>
    current.current.mounted &&
    current.current.scope === owner.scope &&
    current.current.generation === owner.generation &&
    captureDeviceReadAuthority() === owner.authority;
  const key = useMemo(
    () =>
      getQueryKey(
        api.drawingsWorkspace.get,
        options.hyperlinksVisible
          ? { sheetId: options.sheetId }
          : { sheetId: options.sheetId, omitHyperlinks: true },
        "query",
      ),
    [options.sheetId, options.hyperlinksVisible],
  );
  const canPersist = useCallback(
    (value: DrawingWorkspace) => {
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      return Boolean(
        query &&
        !isInstantQueryPending(query) &&
        client.getQueryData(key) === value,
      );
    },
    [client, key],
  );
  const mutation = useInstantMutation<DrawingEntity, Request>({
    mutationKey: [["drawingsWorkspace", "save"]],
    mutationFn: async ({ input, owner }) => {
      if (!owns(owner))
        throw Error(
          "Your drawing workspace changed before this name was sent.",
        );
      const entity = await utils.client.drawingsWorkspace.save.mutate(input);
      if (
        entity.id !== input.id ||
        entity.sheetId !== input.sheetId ||
        entity.kind !== "view" ||
        entity.authorId !== input.expectedUserId ||
        entity.visibility !== "private"
      )
        throw Error("Refresh this drawing to check its saved view.");
      return entity;
    },
    optimistic: ({ input, owner }) => {
      if (
        !owns(owner) ||
        !account?.accountKey ||
        account.userId !== input.expectedUserId
      )
        throw Error("Reopen this drawing before renaming its view.");
      const change = beginInstantQueryUpdate<DrawingWorkspace, DrawingEntity>(
        client,
        key,
        (previous) => {
          if (!eligibleSavedViewName(input, previous))
            throw Error(
              "Only the name of your existing private saved view can change here.",
            );
          return {
            ...previous,
            entities: previous.entities.map((entity) =>
              entity.id === input.id && entity.kind === "view"
                ? {
                    ...entity,
                    data: { ...entity.data, name: input.data.name.trim() },
                  }
                : entity,
            ),
          };
        },
        (entity, previous) => ({
          ...previous,
          entities: previous.entities.map((item) =>
            item.id === input.id ? entity : item,
          ),
        }),
      );
      const preview = client.getQueryData(key),
        query = client.getQueryCache().find({ queryKey: key, exact: true });
      if (!preview) {
        change.finish?.();
        throw Error("Refresh this drawing before renaming its view.");
      }
      const token = { id: input.id, scope: owner.scope };
      pending.current.add(token);
      options.onStarted(input);
      return {
        commit: (entity) => {
          if (ownsCache(owner)) change.commit?.(entity);
        },
        rollback: () => {
          owner.restored =
            ownsCache(owner) &&
            client.getQueryCache().find({ queryKey: key, exact: true }) ===
              query &&
            client.getQueryData(key) === preview;
          if (ownsCache(owner)) change.rollback();
        },
        finish: () => {
          pending.current.delete(token);
          change.finish?.();
        },
      };
    },
    onError: (_error, { input, owner }) => {
      if (owner.restored && owns(owner)) options.onRestore(input);
    },
    onSettled: ({ input, owner }) => {
      if (ownsCache(owner))
        void utils.drawingsWorkspace.get.invalidate({ sheetId: input.sheetId });
    },
    errorMessage:
      "Could not save this view name. Your draft is available to retry.",
  });
  return {
    isPending: mutation.isPending,
    pendingEntityId: mutation.isPending
      ? mutation.variables?.input.id
      : undefined,
    canPersist,
    tryRename: (input: DrawingSave) => {
      if (
        [...pending.current].some(
          (token) => token.id === input.id && token.scope === scope,
        )
      ) {
        notify("This change is still being saved.");
        return true;
      }
      if (
        !eligibleSavedViewName(
          input,
          client.getQueryData<DrawingWorkspace>(key),
        )
      )
        return false;
      const parsed = drawingSaveSchema.parse({
        ...input,
        expectedUserId: account?.userId,
      });
      if (parsed.kind !== "view") return false;
      mutation.mutate({
        input: parsed,
        owner: {
          scope,
          generation: current.current.generation,
          authority: captureDeviceReadAuthority(),
          accountKey: account?.accountKey ?? "",
          restored: false,
        },
      });
      return true;
    },
  };
}
