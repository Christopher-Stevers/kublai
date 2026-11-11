"use client";

import { useMutation, type MutationKey } from "@tanstack/react-query";
import { notify } from "~/components/ui/app-dialogs";
import type { InstantChange } from "~/lib/instant-query-update";

type Options<TData, TVariables> = {
  mutationKey: MutationKey;
  mutationFn: (input: TVariables) => Promise<TData>;
  optimistic: (input: TVariables) => InstantChange<TData>;
  onSuccess?: (result: TData, input: TVariables) => void;
  onError?: (error: Error, input: TVariables) => void;
  onSettled?: (input: TVariables) => void;
  errorMessage: string;
};

/** Tier-one writes render synchronously, then send once. They never pause for
 * connectivity or replay on reconnect. Durable edits remain in Replicache. */
export function useInstantMutation<TData, TVariables>(options: Options<TData, TVariables>) {
  type Request = {
    input: TVariables;
    change?: InstantChange<TData>;
    preparationError?: Error;
    options: Options<TData, TVariables>;
  };
  const mutation = useMutation<TData, Error, Request>({
    mutationKey: options.mutationKey,
    networkMode: "always",
    retry: false,
    mutationFn: (request) => {
      if (request.preparationError) throw request.preparationError;
      if (!navigator.onLine) throw new Error("Reconnect before saving this change.");
      return request.options.mutationFn(request.input);
    },
    onSuccess: (result, request) => {
      // A failed reconciliation must not report a successful server write as a
      // refused write, or roll it back. The next authoritative refresh repairs it.
      try {
        request.change?.commit?.(result);
        request.options.onSuccess?.(result, request.input);
      } catch {
        notify("Saved. Reopen this screen to refresh it.");
      }
    },
    onError: (error, request) => {
      try {
        request.change?.rollback();
      } catch {
        // Still finish the transaction and report failure if a consumer's
        // rollback cannot run (for example after its view has been removed).
      }
      try {
        request.options.onError?.(error, request.input);
      } catch { /* The shared notice remains available if the view is gone. */ }
      notify(request.preparationError?.message ?? request.options.errorMessage, "error");
    },
    onSettled: (_result, _error, request) => {
      request.change?.finish?.();
      // A rejected overlapping/offline edit did not contact the server. In
      // particular it must not refetch over the first edit that is still pending.
      if (!request.preparationError) {
        try { request.options.onSettled?.(request.input); }
        catch { notify("Reopen this screen to refresh it."); }
      }
    },
  });

  const prepare = (input: TVariables): Request => {
    try {
      if (!navigator.onLine) throw new Error("Reconnect before saving this change.");
      return { input, change: options.optimistic(input), options };
    } catch (error) {
      return { input, options, preparationError: error instanceof Error ? error : new Error(options.errorMessage) };
    }
  };

  return {
    ...mutation,
    variables: mutation.variables?.input,
    mutate: (input: TVariables) => mutation.mutate(prepare(input)),
    mutateAsync: (input: TVariables) => mutation.mutateAsync(prepare(input)),
  };
}
