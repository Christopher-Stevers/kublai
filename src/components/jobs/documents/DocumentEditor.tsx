"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CheckIcon,
  Loader2Icon,
  LockIcon,
  RefreshCwIcon,
  SaveIcon,
  XIcon,
} from "lucide-react";
import { useSnapshot } from "~/components/chat/SnapshotProvider";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import { CameraIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { confirmAction } from "~/components/ui/app-dialogs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import type {
  DocumentEditorLaunch as EditorLaunch,
  DocumentEditorStatus,
} from "~/server/documents/types";

export type EditorAvailability = DocumentEditorStatus;
export function supportsDocumentEditor(name: string) {
  return /\.(docx|xlsx|pptx|odt|ods|odp)$/i.test(name);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseMessage(
  value: unknown,
): { MessageId: string; Values: Record<string, unknown> } | null {
  try {
    const parsed: unknown =
      typeof value === "string" && value.length < 50_000
        ? JSON.parse(value)
        : value;
    if (!record(parsed) || typeof parsed.MessageId !== "string") return null;
    return {
      MessageId: parsed.MessageId,
      Values: record(parsed.Values) ? parsed.Values : {},
    };
  } catch {
    return null;
  }
}
async function launchEditor(
  jobId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<EditorLaunch> {
  const response = await fetch("/api/job-documents/editor", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, documentId }),
    signal,
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      record(value) && typeof value.error === "string"
        ? value.error
        : "The document editor could not be opened. Please try again.",
    );
  if (
    !record(value) ||
    value.provider !== "collabora" ||
    value.documentId !== documentId ||
    typeof value.wopiSrc !== "string" ||
    typeof value.actionUrl !== "string" ||
    typeof value.accessToken !== "string" ||
    !value.accessToken ||
    typeof value.accessTokenTtl !== "number" ||
    value.accessTokenTtl <= Date.now() ||
    (value.mode !== "edit" && value.mode !== "view")
  )
    throw new Error("The server returned an invalid editor session.");
  const url = new URL(value.actionUrl);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.searchParams.has("access_token")
  )
    throw new Error("The server returned an invalid editor address.");
  return value as EditorLaunch;
}

/** Tokens stay in memory and are sent to the configured editor through a POST form. */
export function DocumentEditor({
  jobId,
  documentId,
  name,
  onClose,
}: {
  jobId: string;
  documentId: string;
  name: string;
  onClose: () => void;
}) {
  const snapshot = useSnapshot();
  const frameName = `document-editor-${useId().replaceAll(":", "")}`;
  const frame = useRef<HTMLIFrameElement>(null);
  const savingOverlay = useRef<HTMLDivElement>(null);
  const session = useRef<EditorLaunch | null>(null);
  const submitted = useRef(false);
  const ready = useRef(false);
  const dirty = useRef(false);
  const saveInFlight = useRef(false);
  const renewing = useRef(false);
  const closing = useRef(false);
  const closeAfterSave = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receiptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{
    requestId: string;
    controller: AbortController;
  } | null>(null);
  const unconfirmedSave = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [launch, setLaunch] = useState<EditorLaunch | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [renewingToken, setRenewingToken] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useSnapshotSource("document", () => ({
    jobId,
    documentId,
    versionId: session.current?.versionId ?? null,
    tab: "details",
    viewer: "office",
  }));

  const post = useCallback(
    (MessageId: string, Values: Record<string, unknown> = {}) => {
      const current = session.current;
      if (!current || !frame.current?.contentWindow) return;
      frame.current.contentWindow.postMessage(
        JSON.stringify({ MessageId, SendTime: Date.now(), Values }),
        new URL(current.actionUrl).origin,
      );
    },
    [],
  );
  const finishClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    post("Action_Close");
    onCloseRef.current();
  }, [post]);
  const save = useCallback(
    async (close = false) => {
      if (
        !ready.current ||
        !session.current ||
        saveInFlight.current ||
        closing.current
      )
        return;
      if (!navigator.onLine) {
        setError(
          "You are offline. Keep the editor open and reconnect before saving.",
        );
        return;
      }
      const requestId = crypto.randomUUID();
      const controller = new AbortController();
      pendingSave.current = { requestId, controller };
      const isCurrent = () =>
        !controller.signal.aborted &&
        pendingSave.current?.requestId === requestId;
      const stopWaiting = () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        if (receiptTimer.current) clearTimeout(receiptTimer.current);
        controller.abort();
        pendingSave.current = null;
        saveInFlight.current = false;
        setSaving(false);
      };
      closeAfterSave.current = close;
      saveInFlight.current = true;
      unconfirmedSave.current = true;
      dirty.current = true;
      setSaving(true);
      setModified(true);
      setError(null);
      setSaved(false);
      saveTimer.current = setTimeout(() => {
        if (!isCurrent()) return;
        closeAfterSave.current = false;
        stopWaiting();
        setError(
          "The project server has not confirmed this save. Your editor remains open. Try Save again before closing; any later response to this attempt will not close the editor.",
        );
      }, 45_000);
      const poll = async () => {
        if (!isCurrent()) return;
        try {
          const query = new URLSearchParams({ jobId, documentId, requestId });
          const response = await fetch(
            `/api/job-documents/editor/save?${query}`,
            {
              credentials: "same-origin",
              cache: "no-store",
              signal: controller.signal,
            },
          );
          const receipt: unknown = await response.json().catch(() => null);
          if (!isCurrent()) return;
          if (
            !response.ok ||
            !record(receipt) ||
            receipt.requestId !== requestId ||
            (receipt.status !== "pending" && receipt.status !== "committed")
          )
            throw new Error(
              "Save confirmation could not be checked. Keep the editor open and check your connection.",
            );
          if (
            receipt.status === "committed" &&
            typeof receipt.versionId === "string" &&
            typeof receipt.committedAt === "string"
          ) {
            const shouldClose = closeAfterSave.current;
            if (session.current) session.current.versionId = receipt.versionId;
            stopWaiting();
            closeAfterSave.current = false;
            unconfirmedSave.current = false;
            dirty.current = false;
            setModified(false);
            setSaved(true);
            setError(null);
            if (shouldClose) finishClose();
            return;
          }
        } catch (reason) {
          if (isCurrent())
            setError(
              reason instanceof Error
                ? reason.message
                : "Save confirmation could not be checked.",
            );
        }
        if (isCurrent())
          receiptTimer.current = setTimeout(() => void poll(), 750);
      };
      try {
        const response = await fetch("/api/job-documents/editor/save", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, documentId, requestId }),
          signal: controller.signal,
        });
        const intent: unknown = await response.json().catch(() => null);
        if (!isCurrent()) return;
        if (
          !response.ok ||
          !record(intent) ||
          intent.requestId !== requestId ||
          intent.status !== "pending"
        )
          throw new Error(
            "The project server could not start a verified save. Keep your document open and try again.",
          );
        // Collabora's core acknowledgement precedes WOPI storage. Only the correlated receipt above proves persistence.
        post("Action_Save", {
          DontTerminateEdit: false,
          DontSaveIfUnmodified: false,
          Notify: true,
          ExtendedData: JSON.stringify({ foremanhqSaveRequestId: requestId }),
        });
        void poll();
      } catch (reason) {
        if (!isCurrent()) return;
        stopWaiting();
        closeAfterSave.current = false;
        setError(
          reason instanceof Error
            ? reason.message
            : "The project server could not start a verified save.",
        );
      }
    },
    [documentId, finishClose, jobId, post],
  );
  const requestClose = useCallback(() => {
    if (saveInFlight.current || closing.current) return;
    if (!ready.current || session.current?.mode === "view") finishClose();
    else void save(true);
  }, [finishClose, save]);
  useHeaderBackOverride(requestClose);

  const renewToken = useCallback(async () => {
    if (renewing.current || !session.current || closing.current) return;
    renewing.current = true;
    setRenewingToken(true);
    try {
      const replacement = await launchEditor(jobId, documentId);
      if (
        replacement.wopiSrc !== session.current?.wopiSrc ||
        new URL(replacement.actionUrl).origin !==
          new URL(session.current.actionUrl).origin
      )
        throw new Error(
          "The editor service changed during this session. Keep your document open and contact your project administrator.",
        );
      if (replacement.mode !== session.current.mode)
        throw new Error(
          "Your document permissions changed. Keep the editor open and download a copy of any unsaved work before leaving.",
        );
      session.current = replacement;
      setLaunch(replacement);
      post("Reset_Access_Token", {
        token: replacement.accessToken,
        ttl: replacement.accessTokenTtl,
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? `Session renewal failed. ${reason.message}`
          : "Your editing session could not be renewed. Keep the editor open and save or download your work.",
      );
    } finally {
      renewing.current = false;
      setRenewingToken(false);
    }
  }, [jobId, documentId, post]);

  useEffect(() => {
    if (saving) savingOverlay.current?.focus();
  }, [saving]);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void launchEditor(jobId, documentId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          session.current = result;
          setLaunch(result);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "The document editor could not be opened.",
          );
      });
    return () => {
      controller.abort();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (receiptTimer.current) clearTimeout(receiptTimer.current);
      pendingSave.current?.controller.abort();
    };
  }, [jobId, documentId, attempt]);

  useEffect(() => {
    if (!launch || submitted.current || !frame.current) return;
    submitted.current = true;
    const form = window.document.createElement("form");
    form.method = "POST";
    form.action = launch.actionUrl;
    form.target = frameName;
    form.hidden = true;
    for (const [key, value] of Object.entries({
      access_token: launch.accessToken,
      access_token_ttl: String(launch.accessTokenTtl),
    })) {
      const input = window.document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }
    window.document.body.appendChild(form);
    try {
      form.submit();
    } catch {
      setError(
        "The editor could not be started. Check your connection and try again.",
      );
    } finally {
      form.remove();
    }
  }, [launch, frameName]);

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (
        !session.current ||
        event.origin !== new URL(session.current.actionUrl).origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const message = parseMessage(event.data);
      if (!message) return;
      const values = message.Values;
      switch (message.MessageId) {
        case "App_LoadingStatus":
          if (values.Status === "Frame_Ready") {
            post("Host_PostmessageReady");
            post("Disable_Default_UIAction", {
              action: "UI_Close",
              disable: true,
            });
          }
          if (values.Status === "Document_Loaded") {
            ready.current = true;
            setLoaded(true);
            setError(null);
            post("Disable_Default_UIAction", {
              action: "UI_Close",
              disable: true,
            });
          }
          break;
        case "Doc_ModifiedStatus":
          if (
            typeof values.Modified === "boolean" &&
            (values.Modified || !unconfirmedSave.current)
          ) {
            if (values.Modified) unconfirmedSave.current = true;
            dirty.current = values.Modified;
            setModified(values.Modified);
            if (values.Modified) setSaved(false);
          }
          break;
        case "Action_Save_Resp":
          // This uncorrelated message can describe core serialization rather than durable storage.
          // It may explain a problem, but never completes or closes a save attempt.
          if (
            saveInFlight.current &&
            values.success === false &&
            values.result !== "unmodified"
          )
            setError(
              "The editor reported a save problem. Waiting for the project server to confirm whether the file was stored. Keep this window open.",
            );
          break;
        case "Action_Load_Resp":
          if (values.success === false)
            setError(
              "The editor could not load this file. Return to Documents or retry opening it.",
            );
          break;
        case "UI_Close":
          requestClose();
          break;
        case "App_TokenExpiring":
        case "App_TokenExpired":
          void renewToken();
          break;
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [post, renewToken, requestClose]);

  useEffect(() => {
    if (!launch || loaded) return;
    const timer = setTimeout(
      () =>
        setError(
          "The editor is taking too long to connect. Check your connection or ask your project administrator to check the editing service.",
        ),
      45_000,
    );
    return () => clearTimeout(timer);
  }, [launch, loaded]);
  useEffect(() => {
    if (!launch) return;
    const timer = setTimeout(
      () => void renewToken(),
      Math.max(30_000, launch.accessTokenTtl - Date.now() - 5 * 60_000),
    );
    return () => clearTimeout(timer);
  }, [launch, renewToken]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty.current || saveInFlight.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);

  const discardAndClose = async () => {
    if (saveInFlight.current || closing.current) return;
    const confirmed = await confirmAction({
      title: "Close without saving?",
      description:
        "Any changes that have not been saved may be lost. Cancel and download a copy from the editor first if you want to keep them.",
      confirmLabel: "Close without saving",
      destructive: true,
    });
    // A save may have started from the editor while the confirmation was open.
    if (confirmed && !saveInFlight.current) finishClose();
  };

  const retry = () => {
    if (ready.current) return;
    session.current = null;
    submitted.current = false;
    setLaunch(null);
    setAttempt((value) => value + 1);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent
        data-snapshot-source-title={name}
        showCloseButton={false}
        className="fixed inset-0 flex h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
      >
        <header className="bg-background flex shrink-0 flex-col items-stretch gap-2 border-b px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm sm:text-base">
              {name}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              Collabora Online ·{" "}
              {launch?.mode === "view"
                ? "Read-only"
                : "Open-source document editing"}
            </DialogDescription>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span
              role="status"
              className="text-muted-foreground flex items-center gap-1 text-xs"
            >
              {saving ? (
                <>
                  <Loader2Icon className="size-3 animate-spin" />
                  Saving…
                </>
              ) : renewingToken ? (
                "Renewing session…"
              ) : launch?.mode === "view" ? (
                <>
                  <LockIcon className="size-3" />
                  Read-only
                </>
              ) : modified ? (
                "Changes pending"
              ) : saved ? (
                <>
                  <CheckIcon className="size-3" />
                  Save confirmed
                </>
              ) : loaded ? (
                "No pending changes"
              ) : (
                "Connecting…"
              )}
            </span>
            {loaded && launch?.mode === "edit" && (
              <Button
                variant="outline"
                size="sm"
                disabled={saving || offline}
                onClick={() => void save()}
              >
                <SaveIcon />
                Save
              </Button>
            )}
            {snapshot && (
              <Button
                variant="outline"
                size="sm"
                disabled={!loaded || saving}
                onClick={() => snapshot.start()}
              >
                <CameraIcon />
                Snapshot
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={requestClose}
            >
              {saving ? <Loader2Icon className="animate-spin" /> : <XIcon />}
              {loaded && launch?.mode === "edit" ? "Save & close" : "Close"}
            </Button>
          </div>
        </header>
        {offline && (
          <p
            role="alert"
            className="shrink-0 border-b bg-amber-500/10 px-4 py-2 text-sm"
          >
            You are offline. Keep the editor open. Reconnect before saving or
            closing.
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="bg-destructive/10 text-destructive flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-sm"
          >
            <p className="flex-1">{error}</p>
            {!loaded ? (
              <Button size="sm" variant="outline" onClick={retry}>
                <RefreshCwIcon />
                Retry
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={renewingToken || offline}
                onClick={() => void renewToken()}
              >
                Renew session
              </Button>
            )}
            {loaded && !saving && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void discardAndClose()}
              >
                Close without saving
              </Button>
            )}
          </div>
        )}
        <div className="relative min-h-0 flex-1">
          {launch && (
            <iframe
              ref={frame}
              inert={!loaded || saving}
              tabIndex={!loaded || saving ? -1 : 0}
              name={frameName}
              title={`Edit ${name}`}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              allow="clipboard-read; clipboard-write; fullscreen"
              referrerPolicy="no-referrer"
              onLoad={() => post("Host_PostmessageReady")}
            />
          )}
          {!loaded && (
            <div className="bg-background absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <Loader2Icon className="text-primary size-8 animate-spin" />
              <p className="font-medium">
                {error
                  ? "Document editor unavailable"
                  : "Opening your document…"}
              </p>
              <p className="text-muted-foreground max-w-md text-sm">
                {error
                  ? "Your saved document is still available in Documents."
                  : "Connecting to the editing service. Your files stay in this project."}
              </p>
            </div>
          )}
          {saving && (
            <div
              ref={savingOverlay}
              tabIndex={-1}
              className="bg-background/40 absolute inset-0 flex items-center justify-center outline-none"
            >
              <div className="bg-background flex items-center gap-2 rounded-lg border p-4 shadow-sm">
                <Loader2Icon className="size-5 animate-spin" />
                Waiting for the project server to confirm the save…
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
