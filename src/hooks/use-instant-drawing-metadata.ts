"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  useQueryClient,
  hashKey,
  replaceEqualDeep,
  type QueryKey,
  type QueryClient,
} from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import {
  beginInstantQueryUpdate,
  isInstantQueryPending,
} from "~/lib/instant-query-update";
import { drawingMoveTargets } from "~/lib/drawing-folder-move";
import { useInstantMutation } from "./use-instant-mutation";

export type DrawingSetList = RouterOutputs["drawings"]["listSets"];
export type DrawingSetDetail = RouterOutputs["drawings"]["getSet"];
type MoveInput = RouterInputs["drawings"]["moveSet"];
type MoveResult = RouterOutputs["drawings"]["moveSet"];
type RenameInput = RouterInputs["drawings"]["renameSheet"];
type RenameResult = RouterOutputs["drawings"]["renameSheet"];
type Folder = DrawingSetList["sets"][number];
type Sheet = DrawingSetDetail["sheets"][number];

function settledData<T>(client: QueryClient, key: QueryKey): T | undefined {
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  return query && !isInstantQueryPending(query)
    ? client.getQueryData<T>(key)
    : undefined;
}

function useSettledMarker(client: QueryClient, key: QueryKey) {
  const hash = useMemo(() => hashKey(key), [key]);
  const subscribe = useCallback(
    (notify: () => void) =>
      client.getQueryCache().subscribe((event) => {
        if (event.query.queryHash === hash) notify();
      }),
    [client, hash],
  );
  const snapshot = useCallback(() => {
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    return Boolean(query && !isInstantQueryPending(query));
  }, [client, key]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Reversible folder/sheet labels only. This does not touch the existing
 * drawing entity queue, workspace revisions, upload state or permissions. */
export function useInstantDrawingMetadata({
  jobId,
  setId,
  onMoveStarted,
  onMoveConfirmed,
}: {
  jobId: string;
  setId: string | null;
  onMoveStarted?: () => void;
  onMoveConfirmed?: () => void;
}) {
  const client = useQueryClient(),
    utils = api.useUtils();
  const setsKey = useMemo(
    () => getQueryKey(api.drawings.listSets, { jobId }, "query"),
    [jobId],
  );
  const setKey = useMemo(
    () => getQueryKey(api.drawings.getSet, { setId: setId ?? "" }, "query"),
    [setId],
  );
  const setsSettled = useSettledMarker(client, setsKey);
  const setSettled = useSettledMarker(client, setKey);
  const seedAccepted = <T>(key: QueryKey, fallback: T | undefined) => {
    // Cancel before seeding: reverting an in-flight query must not erase the
    // already-authorized device snapshot used to paint this screen.
    void client.cancelQueries({ queryKey: key, exact: true });
    if (client.getQueryData(key) === undefined && fallback !== undefined)
      client.setQueryData(key, fallback);
    if (client.getQueryData(key) === undefined)
      throw new Error(
        "Open this drawing folder while connected before editing it.",
      );
  };
  const move = useInstantMutation<
    MoveResult,
    { input: MoveInput; fallback?: DrawingSetList }
  >({
    mutationKey: [["drawings", "moveSet"]],
    mutationFn: ({ input }) => utils.client.drawings.moveSet.mutate(input),
    optimistic: ({ input, fallback }) => {
      seedAccepted(setsKey, fallback);
      const change = beginInstantQueryUpdate<DrawingSetList, MoveResult>(
        client,
        setsKey,
        (previous) => {
          const source = previous.sets.find(
            (folder: Folder) => folder.id === input.setId,
          );
          if (!source)
            throw new Error(
              "This folder is no longer available on this device.",
            );
          if (
            input.parentId &&
            !drawingMoveTargets(previous.sets, input.setId).some(
              (folder) => folder.id === input.parentId,
            )
          )
            throw new Error(
              "Choose a folder outside the folder being moved and its subfolders.",
            );
          return {
            ...previous,
            sets: previous.sets.map((folder: Folder) =>
              folder.id === input.setId
                ? { ...folder, parentId: input.parentId }
                : folder,
            ),
          };
        },
      );
      try {
        onMoveStarted?.();
      } catch (error) {
        change.rollback();
        change.finish?.();
        throw error;
      }
      return change;
    },
    onSuccess: onMoveConfirmed,
    onSettled: ({ input }) => {
      void utils.drawings.listSets.invalidate({ jobId });
      void utils.drawingsWorkspace.list.invalidate({ jobId });
      void utils.drawings.getSet.invalidate({ setId: input.setId });
      if (setId && setId !== input.setId)
        void utils.drawings.getSet.invalidate({ setId });
    },
    errorMessage: "The folder move could not be saved. Please try again.",
  });
  const rename = useInstantMutation<
    RenameResult,
    { input: RenameInput; fallback?: DrawingSetDetail }
  >({
    mutationKey: [["drawings", "renameSheet"]],
    mutationFn: ({ input }) => utils.client.drawings.renameSheet.mutate(input),
    optimistic: ({ input, fallback }) => {
      const name = input.name.trim();
      if (!name || name.length > 255)
        throw new Error("Use a drawing name between 1 and 255 characters.");
      if (
        !setId ||
        (fallback &&
          (fallback.set?.id !== setId || fallback.set.jobId !== jobId))
      )
        throw new Error("Open this drawing's folder before renaming it.");
      seedAccepted(setKey, fallback);
      return beginInstantQueryUpdate<DrawingSetDetail, RenameResult>(
        client,
        setKey,
        (previous) => {
          if (
            previous.set.id !== setId ||
            previous.set.jobId !== jobId ||
            !previous.sheets.some((sheet: Sheet) => sheet.id === input.sheetId)
          )
            throw new Error(
              "This drawing is no longer available in the open folder.",
            );
          return {
            ...previous,
            sheets: previous.sheets.map((sheet: Sheet) =>
              sheet.id === input.sheetId ? { ...sheet, name } : sheet,
            ),
          };
        },
      );
    },
    onSettled: () => {
      if (setId) void utils.drawings.getSet.invalidate({ setId });
      void utils.drawings.listSets.invalidate({ jobId });
      void utils.drawingsWorkspace.list.invalidate({ jobId });
      void utils.drawingsWorkspace.get.invalidate();
    },
    errorMessage: "The drawing name could not be saved. Please try again.",
  });
  // Query-cache marker changes recheck persistence after finish(), even when
  // a refused overlapping edit means the mutation observer follows a later call.
  const acceptedSets = useCallback(
    () =>
      setsSettled ? settledData<DrawingSetList>(client, setsKey) : undefined,
    [client, setsKey, setsSettled],
  );
  const acceptedSet = useCallback(
    (targetId: string) => {
      if (targetId === setId && !setSettled) return undefined;
      const value = settledData<DrawingSetDetail>(
        client,
        getQueryKey(api.drawings.getSet, { setId: targetId }, "query"),
      );
      return value?.set.jobId === jobId ? value : undefined;
    },
    [client, jobId, setId, setSettled],
  );
  const canPersistSets = useCallback(
    (value: DrawingSetList) => {
      const accepted = acceptedSets();
      return (
        accepted !== undefined && replaceEqualDeep(accepted, value) === accepted
      );
    },
    [acceptedSets],
  );
  const canPersistSet = useCallback(
    (value: DrawingSetDetail) => {
      const accepted = value?.set?.id ? acceptedSet(value.set.id) : undefined;
      // fetchQuery can return a fresh but structurally equal accepted response.
      // A pending, removed or superseded query still cannot persist a preview.
      return (
        accepted !== undefined && replaceEqualDeep(accepted, value) === accepted
      );
    },
    [acceptedSet],
  );
  return {
    moveSet: {
      ...move,
      mutate: (input: MoveInput, fallback?: DrawingSetList) =>
        move.mutate({ input, fallback }),
    },
    renameSheet: {
      ...rename,
      mutate: (input: RenameInput, fallback?: DrawingSetDetail) =>
        rename.mutate({ input, fallback }),
    },
    canPersistSets,
    canPersistSet,
    acceptedSets,
    acceptedSet,
  };
}
