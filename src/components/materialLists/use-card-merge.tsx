"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import { requestMaterialListReplicacheSync } from "~/lib/replicache-material-list";
import { notify } from "~/components/ui/app-dialogs";
import { Button } from "~/components/ui/button";

type List = { id: string; name: string; kind?: "materials" | "tools" };

/** Both the Jobs workspace and the dedicated job page use card selection. */
export function useCardMerge({ disabled, onMerged }: {
  disabled: boolean;
  onMerged: () => void;
}) {
  const [source, setSource] = useState<List | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const flight = useRef<{ clone: HTMLElement; from: DOMRect; to: DOMRect } | null>(null);
  const animatedClones = useRef(new Set<HTMLElement>());
  const inFlight = useRef(false);
  useEffect(() => {
    const clones = animatedClones.current;
    return () => {
      flight.current?.clone.remove();
      for (const clone of clones) clone.remove();
      clones.clear();
    };
  }, []);

  const merge = api.materialList.merge.useMutation({
    onSuccess: ({ id, movedCount, sourceDeleted }) => {
      const snapshot = flight.current;
      flight.current = null;
      setSource(null);
      setTargetId(null);
      inFlight.current = false;
      // The server has accepted the merge. Refresh now; decorative motion must
      // never postpone reconciliation or keep the controls locked.
      requestMaterialListReplicacheSync();
      onMerged();
      notify(`${movedCount} unlocked ${movedCount === 1 ? "item merged" : "items merged"}. ${sourceDeleted ? "Empty source list removed." : "Locked items remain in the original list."}`, "success");
      if (snapshot && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const { clone, from, to } = snapshot;
        Object.assign(clone.style, {
          position: "fixed", left: `${from.left}px`, top: `${from.top}px`,
          width: `${from.width}px`, height: `${from.height}px`, margin: "0",
          zIndex: "100", pointerEvents: "none", transformOrigin: "center",
          overflow: "hidden",
        });
        document.body.appendChild(clone);
        animatedClones.current.add(clone);
        const removeClone = () => { clone.remove(); animatedClones.current.delete(clone); };
        try {
          void clone.animate([
            { transform: "translate(0, 0) scale(1)", opacity: 0.85 },
            { transform: `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top + to.height / 2 - from.top - from.height / 2}px) scale(0.15)`, opacity: 0 },
          ], { duration: 150, easing: "cubic-bezier(.4,0,.2,1)" }).finished.then(removeClone, removeClone);
          const pulse = cards.current.get(id)?.animate([
            { transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" },
          ], { duration: 150, easing: "ease-out" });
          void pulse?.finished.catch(() => undefined);
        } catch {
          // Unsupported/interrupted animation cannot turn an accepted merge
          // into a failed request or leave a temporary card behind.
          removeClone();
        }
      }
    },
    onError: error => {
      flight.current?.clone.remove();
      flight.current = null;
      inFlight.current = false;
      setTargetId(null);
      notify(error.message, "error");
    },
  });
  useEffect(() => {
    if (!source) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !inFlight.current) setSource(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [source]);

  function pick(list: List) {
    if (!source || list.id === source.id || list.kind === "tools" || disabled || inFlight.current) return;
    inFlight.current = true;
    setTargetId(list.id);
    const origin = cards.current.get(source.id);
    const destination = cards.current.get(list.id);
    if (origin && destination) {
      const clone = origin.cloneNode(true) as HTMLElement;
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
      clone.setAttribute("aria-hidden", "true");
      clone.inert = true;
      flight.current = { clone, from: origin.getBoundingClientRect(), to: destination.getBoundingClientRect() };
    }
    merge.mutate({ sourceId: source.id, targetId: list.id });
  }

  const pending = targetId !== null || merge.isPending;
  return {
    active: !!source,
    isPending: pending,
    begin: (list: List) => { if (!inFlight.current) { setSource(list); setTargetId(null); } },
    pick,
    cardProps: (list: List) => ({
      ref: (node: HTMLDivElement | null) => { if (node) cards.current.set(list.id, node); else cards.current.delete(list.id); },
      ...(source ? {
        role: "button" as const,
        tabIndex: list.id !== source.id && list.kind !== "tools" ? 0 : -1,
        "aria-label": list.id === source.id ? `Merge source: ${list.name}` : `Merge into ${list.name}`,
        "aria-disabled": disabled || pending || list.id === source.id || list.kind === "tools",
        "aria-busy": pending && (list.id === source.id || list.id === targetId),
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(list); }
        },
      } : {}),
    }),
    cardClassName: (list: List) => !source ? "" : list.id === source.id
      ? " ring-2 ring-amber-500 opacity-60"
      : list.kind === "tools" ? " opacity-40" : list.id === targetId
      ? " ring-4 ring-primary" : " ring-2 ring-primary/50 hover:ring-primary",
    banner: source ? (
      <div role="status" className="sticky top-0 z-20 mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-background p-3 shadow-md">
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{pending ? "Merging…" : `Tap another list to merge “${source.name}” into it`}</p>
          <p className="text-muted-foreground">Only unlocked items move. Empty source lists are removed.</p>
        </div>
        <Button variant="outline" disabled={pending} onClick={() => { if (!inFlight.current) setSource(null); }}>Cancel</Button>
      </div>
    ) : null,
  };
}
