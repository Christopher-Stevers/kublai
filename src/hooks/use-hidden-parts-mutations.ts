"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "~/trpc/react";
import { addHideRule, removeHideRule, restoreHiddenSelection } from "~/lib/catalogue-hidden";
import { beginInstantQueryUpdate } from "~/lib/instant-query-update";
import { useInstantMutation } from "./use-instant-mutation";

type Settings = RouterOutputs["catalogue"]["getHiddenParts"];

export function useHiddenPartsMutations(onHidden?: () => void) {
  const client = useQueryClient();
  const utils = api.useUtils();
  const key = getQueryKey(api.catalogue.getHiddenParts, undefined, "query");
  const refresh = () => { void utils.catalogue.getHiddenParts.invalidate(); };
  const hide = useInstantMutation({
    mutationKey: [["catalogue", "hideParts"]],
    mutationFn: (input: RouterInputs["catalogue"]["hideParts"]) => utils.client.catalogue.hideParts.mutate(input),
    optimistic: (input) => beginInstantQueryUpdate<Settings, Settings>(client, key, old => ({
      rules: (Array.isArray(input.criteria) ? input.criteria : [input.criteria])
        .reduce((rules, criteria) => addHideRule(criteria)(rules), old.rules),
    }), result => result),
    onSuccess: () => onHidden?.(),
    onSettled: refresh,
    errorMessage: "Could not hide those parts. Please try again.",
  });
  const show = useInstantMutation({
    mutationKey: [["catalogue", "showHiddenParts"]],
    mutationFn: (input: RouterInputs["catalogue"]["showHiddenParts"]) => utils.client.catalogue.showHiddenParts.mutate(input),
    optimistic: (input) => beginInstantQueryUpdate<Settings, Settings>(client, key, old => ({
      rules: "ruleId" in input ? removeHideRule(input.ruleId)(old.rules) : restoreHiddenSelection(old.rules, input.criteria),
    }), result => result),
    onSettled: refresh,
    errorMessage: "Could not unhide those parts. Please try again.",
  });
  return { hide, show };
}
