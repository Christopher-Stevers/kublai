"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { z } from "zod";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { Button } from "~/components/ui/button";
import { notify } from "~/components/ui/app-dialogs";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { drawingMarkupLinks, MAX_DRAWING_LINKS } from "~/lib/drawing-links";
import {
  drawingSaveSchema,
  type DrawingSave,
  type DrawingEntity,
  type DrawingWorkspace,
} from "~/lib/drawing-workspace";
import {
  snapshotSourceSchema,
  type SnapshotSource,
} from "~/lib/snapshot-source";
import { api } from "~/trpc/react";
import { useDrawingAccount } from "./DrawingAccountProvider";
import { useDrawingQueuedEdits } from "./useDrawingQueuedEdits";

type MarkupSave = Extract<DrawingSave, { kind: "markup" }>;
export type DestinationRequest = {
  jobId: string;
  draft: MarkupSave;
  baseEntity?: DrawingEntity;
  authorName: string;
};
type Request = DestinationRequest & { returnTo: SnapshotSource };
type Resume = Request & { saved: boolean };
type Session =
  | { phase: "picking"; request: Request }
  | { phase: "resume"; request: Resume };
const storedSessionSchema = z.object({
  phase: z.enum(["picking", "resume"]),
  request: z.object({
    jobId: z.uuid(),
    draft: drawingSaveSchema,
    authorName: z.string().max(255),
    returnTo: snapshotSourceSchema,
    saved: z.boolean().optional(),
  }),
});
function readSession(key: string): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw || raw.length > 1_000_000) return null;
    const saved = storedSessionSchema.parse(JSON.parse(raw) as unknown);
    if (saved.request.draft.kind !== "markup") return null;
    const request = { ...saved.request, draft: saved.request.draft };
    return saved.phase === "picking"
      ? { phase: "picking", request }
      : {
          phase: "resume",
          request: { ...request, saved: saved.request.saved ?? false },
        };
  } catch {
    return null;
  }
}
const Context = createContext<{
  start: (request: DestinationRequest) => boolean;
  resume: Resume | null;
  consumed: () => void;
  active: boolean;
} | null>(null);
export const useDrawingDestination = () => useContext(Context);

/** Lives above the route tree so browsing never unmounts the source draft. */
export function DrawingDestinationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const registry = useContext(SnapshotSourceContext);
  const account = useDrawingAccount();
  const router = useRouter();
  const storageKey = `foremanhq:destination-picker:${account?.accountKey ?? ""}`;
  const [session, setSession] = useState<Session | null>(() =>
    readSession(storageKey),
  );
  const request = session?.phase === "picking" ? session.request : null;
  const resume = session?.phase === "resume" ? session.request : null;
  const commit = (next: Session | null) => {
    try {
      if (next) {
        // The workspace cache supplies the base record after a full page load.
        const draft = structuredClone(next.request.draft);
        if (draft.data.links?.length === 0) delete draft.data.links;
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            ...next,
            request: { ...next.request, baseEntity: undefined, draft },
          }),
        );
      } else window.sessionStorage.removeItem(storageKey);
    } catch {
      /* Continue browsing when session storage is unavailable. */
    }
    setSession(next);
  };
  const finish = (saved: boolean) => {
    if (!request) return;
    commit({ phase: "resume", request: { ...request, saved } });
    router.push(request.returnTo.href, { scroll: false });
  };
  return (
    <Context.Provider
      value={{
        start: (next) => {
          if (!registry || request) return false;
          try {
            const returnTo = registry.captureSource();
            commit({
              phase: "picking",
              request: {
                ...next,
                draft: structuredClone(next.draft),
                returnTo,
              },
            });
            notify(
              "Navigate to your destination, then tap the check mark. Hold it to cancel.",
            );
            return true;
          } catch (reason) {
            notify(
              reason instanceof Error
                ? reason.message
                : "Could not start destination selection.",
              "error",
            );
            return false;
          }
        },
        resume,
        consumed: () => commit(null),
        active: Boolean(request),
      }}
    >
      {children}
      {request && <DestinationPicker request={request} onFinish={finish} />}
    </Context.Provider>
  );
}

function DestinationPicker({
  request,
  onFinish,
}: {
  request: Request;
  onFinish: (saved: boolean) => void;
}) {
  const registry = useContext(SnapshotSourceContext);
  const account = useDrawingAccount();
  const online = useOnlineStatus();
  const utils = api.useUtils();
  const saveMutation = api.drawingsWorkspace.save.useMutation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [host, setHost] = useState<Element | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const frozen = useRef<MarkupSave | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const patch = (entity: DrawingEntity) => {
    utils.drawingsWorkspace.get.setData({ sheetId: entity.sheetId }, (old) =>
      old
        ? {
            ...old,
            entities: [
              ...old.entities.filter((item) => item.id !== entity.id),
              entity,
            ],
          }
        : old,
    );
  };
  const queued = useDrawingQueuedEdits({
    accountKey: account?.store ? account.accountKey : null,
    userId: account?.userId ?? null,
    jobId: request.jobId,
    sheetId: request.draft.sheetId,
    online,
    save: (input) => saveMutation.mutateAsync(input),
    onSaved: patch,
    onError: (reason) => {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save destination.",
        );
    },
  });
  const cancel = () => {
    if (!saving.current) onFinish(false);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (hold.current) clearTimeout(hold.current);
    };
  }, []);
  useEffect(() => {
    const chooseHost = () => {
      const dialogs = [
        ...document.querySelectorAll('[role="dialog"][data-state="open"]'),
      ];
      // Keep the check mark reachable inside modal focus traps and fullscreen.
      setHost(document.fullscreenElement ?? dialogs.at(-1) ?? document.body);
    };
    chooseHost();
    const observer = new MutationObserver(chooseHost);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    document.addEventListener("fullscreenchange", chooseHost);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", chooseHost);
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onFinish(false);
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onFinish]);
  const capture = async () => {
    if (held.current || saving.current || !registry || !account) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!frozen.current) {
        const source = registry.captureSource();
        const links = drawingMarkupLinks(request.draft.data);
        if (links.length >= MAX_DRAWING_LINKS)
          throw Error(
            "This hyperlink already has the maximum number of destinations.",
          );
        if (links.some((link) => link.url === source.href))
          throw Error("This destination is already in the hyperlink.");
        const parsed = drawingSaveSchema.parse({
          ...request.draft,
          expectedUserId: account.userId,
          data: {
            ...request.draft.data,
            href: undefined,
            targetSheetId: undefined,
            links: [
              ...links,
              { label: source.title.slice(0, 255), url: source.href },
            ],
          },
        });
        if (parsed.kind !== "markup")
          throw Error("Choose a drawing hyperlink.");
        frozen.current = parsed;
      }
      if (frozen.current.visibility === "private" && queued.ready) {
        const cached = request.baseEntity
          ? null
          : await account.store?.readSnapshot<DrawingWorkspace>(
              `workspace:${request.draft.sheetId}`,
            );
        await queued.enqueue(
          frozen.current,
          request.baseEntity ??
            cached?.entities.find((entity) => entity.id === request.draft.id),
          request.authorName,
        );
      } else {
        if (!online)
          throw Error(
            "Reconnect to save this destination, or save the hyperlink as a private draft.",
          );
        patch(await saveMutation.mutateAsync(frozen.current));
      }
      if (!mounted.current) return;
      notify(
        online
          ? "Destination saved."
          : "Destination saved on this device. It will sync when you reconnect.",
        "success",
      );
      onFinish(true);
    } catch (reason) {
      if (mounted.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save destination. Try again.",
        );
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (!host) return null;
  return createPortal(
    <div
      data-snapshot-ui
      className="fixed right-5 z-[250] flex max-w-xs flex-col items-end gap-2"
      style={{
        bottom: "calc(10rem + env(safe-area-inset-bottom))",
        pointerEvents: "auto",
      }}
    >
      {error && (
        <div className="bg-background rounded-md border p-3 text-sm shadow-lg">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={cancel}
          >
            Cancel selection
          </Button>
        </div>
      )}
      <Button
        type="button"
        className="size-14 touch-none rounded-full shadow-xl"
        aria-label="Save current page as destination"
        title="Save destination · hold to cancel"
        disabled={busy}
        onClick={() => void capture()}
        onPointerDown={() => {
          held.current = false;
          hold.current = setTimeout(() => {
            held.current = true;
            cancel();
          }, 700);
        }}
        onPointerUp={() => {
          if (hold.current) clearTimeout(hold.current);
        }}
        onPointerCancel={() => {
          if (hold.current) clearTimeout(hold.current);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          cancel();
        }}
      >
        {busy ? (
          <Loader2Icon className="size-6 animate-spin" aria-hidden />
        ) : (
          <CheckIcon className="size-7" aria-hidden />
        )}
      </Button>
    </div>,
    host,
  );
}
