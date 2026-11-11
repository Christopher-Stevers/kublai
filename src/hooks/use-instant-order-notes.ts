"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { beginInstantQueryUpdate } from "~/lib/instant-query-update";
import { useInstantMutation } from "./use-instant-mutation";

type Input = RouterInputs["materialList"]["updateOrderNotes"];
type Result = RouterOutputs["materialList"]["updateOrderNotes"];
type Order = RouterOutputs["materialList"]["getOrderById"];

export function useInstantOrderNotes(callbacks: {
  onStart: (input: Input) => void;
  onError: (input: Input) => void;
}) {
  const client = useQueryClient();
  const utils = api.useUtils();
  return useInstantMutation({
    mutationKey: [["materialList", "updateOrderNotes"]],
    mutationFn: (input: Input) => utils.client.materialList.updateOrderNotes.mutate(input),
    optimistic: (input) => {
      const key = getQueryKey(api.materialList.getOrderById, { orderId: input.orderId }, "query");
      const notes = input.notes?.trim();
      const change = beginInstantQueryUpdate<Order, Result>(client, key,
        old => ({ ...old, notes: notes === "" || notes === undefined ? null : notes }),
        (result, old) => ({ ...old, notes: result.notes }));
      try { callbacks.onStart(input); }
      catch (error) { change.rollback(); change.finish?.(); throw error; }
      return change;
    },
    onError: (_error, input) => callbacks.onError(input),
    onSettled: ({ orderId }) => { void utils.materialList.getOrderById.invalidate({ orderId }); },
    errorMessage: "Order notes could not be saved. Please try again.",
  });
}
