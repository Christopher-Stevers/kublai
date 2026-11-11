"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Phase = "idle" | "saving" | "refreshing" | "needs-refresh";
function refusalReason(error: unknown) {
  if (!(error instanceof Error) || !("data" in error)) return null;
  const data = error.data;
  if (!data || typeof data !== "object" || !("code" in data)) return null;
  return ["BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT"].includes(String(data.code))
    ? error.message : null;
}

/** Permission edits remain proposals until the server accepts them. This is
 * only an attempt latch/status, never a permission cache or an offline queue. */
export function useMemberSave<Input>(options: {
  save: (input: Input) => Promise<unknown>;
  refresh: () => Promise<void>;
  onSaved: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const current = useRef({ mounted: false, epoch: 0, phase: "idle" as Phase, accepted: false });
  useLayoutEffect(() => {
    const owner = current.current;
    owner.mounted = true;
    owner.epoch++;
    return () => { owner.mounted = false; owner.epoch++; };
  }, []);

  const move = (next: Phase) => {
    current.current.phase = next;
    setPhase(next);
  };
  const reconcile = async (epoch: number, accepted: boolean) => {
    const owns = () => current.current.mounted && current.current.epoch === epoch;
    if (!owns()) return;
    move("refreshing");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // A query can pause indefinitely when connectivity disappears. Bound the
      // read-only wait; an accepted mutation is never retried or called failed.
      await Promise.race([
        options.refresh(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error("Refresh timed out")), 10_000);
        }),
      ]);
    } catch {
      if (!owns()) return;
      move("needs-refresh");
      setError(accepted
        ? "Changes saved. Refresh permissions before making another change."
        : "Permissions could not be refreshed. Your draft is still here.");
      return;
    } finally {
      clearTimeout(deadline);
    }
    if (!owns()) return;
    move("idle");
    setError("");
    current.current.accepted = false;
    if (accepted) options.onSaved();
  };
  return {
    phase,
    error,
    locked: phase !== "idle",
    pending: phase === "saving" || phase === "refreshing",
    save: (input: Input) => {
      if (!current.current.mounted || current.current.phase !== "idle") return;
      if (!navigator.onLine) {
        setError("Reconnect before saving. Your draft is still here.");
        return;
      }
      const epoch = current.current.epoch;
      current.current.accepted = false;
      move("saving");
      setError("");
      void (async () => {
        try {
          await options.save(input);
        } catch (error) {
          if (!current.current.mounted || current.current.epoch !== epoch) return;
          move("needs-refresh");
          const reason = refusalReason(error);
          setError(`${reason ?? "The change could not be confirmed."} Your draft is still here. Refresh permissions before trying again.`);
          return;
        }
        if (!current.current.mounted || current.current.epoch !== epoch) return;
        current.current.accepted = true;
        await reconcile(epoch, true);
      })();
    },
    refresh: () => {
      if (!current.current.mounted || current.current.phase !== "needs-refresh") return;
      if (!navigator.onLine) {
        setError("Reconnect to refresh permissions. Your draft is still here.");
        return;
      }
      void reconcile(current.current.epoch, current.current.accepted);
    },
  };
}
