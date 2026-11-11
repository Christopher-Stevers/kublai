"use client";
import {
  lazy,
  Suspense,
  useState,
  type ComponentProps,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { CameraIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import { FeatureErrorBoundary } from "~/components/app/FeatureErrorBoundary";
import { validChatTarget, type ChatTarget } from "./chat-target";
import type { SnapshotSource } from "~/lib/snapshot-source";
import type { RecipientChooser as RecipientChooserType } from "./RecipientChooser";
const loadRecipientChooser = () =>
  import("./RecipientChooser").then((module) => ({
    default: module.RecipientChooser,
  }));
function RecipientChooser(props: ComponentProps<typeof RecipientChooserType>) {
  const [Panel, setPanel] = useState(() => lazy(loadRecipientChooser));
  return (
    <FeatureErrorBoundary
      allowReload={false}
      onRetry={() => setPanel(() => lazy(loadRecipientChooser))}
    >
      <Suspense
        fallback={
          <p role="status" className="text-muted-foreground text-sm">
            Loading recipients…
          </p>
        }
      >
        <Panel {...props} />
      </Suspense>
    </FeatureErrorBoundary>
  );
}
export type SnapshotControlsProps = {
  phase: "idle" | "capture" | "screen" | "select" | "share" | "error";
  portalHost: Element | null;
  error: string;
  busy: boolean;
  editing: boolean;
  preview: string;
  source: SnapshotSource | null;
  target: ChatTarget;
  message: string;
  locked: boolean;
  savedReady: boolean;
  savedHasSource: boolean;
  savedError: { message: string } | null;
  screenshotInput: RefObject<HTMLInputElement | null>;
  release: () => void;
  beginCapture: () => void;
  cancelEdit: () => void;
  retake: () => void;
  screenCapture: () => void;
  chooseScreenshot: (file?: File) => Promise<void>;
  share: () => Promise<void>;
  setTarget: (value: ChatTarget) => void;
  setMessage: (value: string) => void;
  onDialogChange: (open: boolean) => void;
};
/** Presentation only; capture initiation, controller, context and drafts stay eager. */
export function SnapshotControls(props: SnapshotControlsProps) {
  const {
    phase,
    portalHost,
    error,
    busy,
    editing,
    preview,
    source,
    target,
    message,
    locked,
    savedReady,
    savedHasSource,
    savedError,
    screenshotInput,
    release,
    beginCapture,
    cancelEdit,
    retake,
    screenCapture,
    chooseScreenshot,
    share,
    setTarget,
    setMessage,
    onDialogChange,
  } = props;
  return (
    <>
      {editing &&
        phase === "idle" &&
        portalHost &&
        createPortal(
          <aside
            data-snapshot-ui
            aria-label="Edit saved snapshot"
            className="bg-background fixed inset-x-3 top-16 z-[90] mx-auto max-w-xl space-y-2 rounded-lg border p-3 shadow-lg"
          >
            <p className="text-sm font-semibold">Remake snapshot</p>
            <p
              className="text-muted-foreground text-xs"
              role={savedError ? "alert" : "status"}
            >
              {savedError
                ? savedError.message
                : savedReady
                  ? savedHasSource
                    ? "Capture and send a new snapshot to replace the old one."
                    : "This older snapshot has no saved source. Capture a new view to replace it."
                  : "Opening the saved snapshot…"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={beginCapture}
                disabled={!savedReady || Boolean(savedError)}
              >
                Capture snapshot
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                Cancel edit
              </Button>
            </div>
          </aside>,
          portalHost,
        )}
      <Dialog
        open={phase === "share" || phase === "screen" || phase === "error"}
        onOpenChange={onDialogChange}
      >
        <DialogContent
          excludeFromSnapshot
          portalContainer={portalHost}
          data-snapshot-ui
          className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
          showCloseButton={!busy}
        >
          <input
            ref={screenshotInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            aria-label="Choose screenshot image"
            onChange={(e) => void chooseScreenshot(e.target.files?.[0])}
          />
          <DialogTitle>
            <span className="flex items-center gap-2">
              <CameraIcon className="size-5" />
              Snapshot
            </span>
          </DialogTitle>
          <DialogDescription>
            {phase === "share"
              ? editing
                ? "Choose who should receive this new snapshot. Sending replaces the old snapshot."
                : "Review the image and choose who should receive it."
              : "Capture a selected area and share it in chat."}
          </DialogDescription>
          {phase === "share" ? (
            <>
              <img
                alt="Snapshot preview"
                src={preview}
                className="bg-muted max-h-48 w-full rounded-md border object-contain"
              />
              {source && (
                <p className="text-muted-foreground text-xs">
                  Includes a link back to{" "}
                  <span className="font-medium">{source.title}</span> in this
                  view.
                </p>
              )}
              <RecipientChooser
                value={target}
                onChange={setTarget}
                disabled={busy || locked}
              />
              <label className="space-y-1 text-sm">
                Message (optional)
                <textarea
                  aria-label="Snapshot message"
                  disabled={busy || locked}
                  value={message}
                  maxLength={8000}
                  onChange={(e) => setMessage(e.target.value)}
                  className="bg-background block min-h-20 w-full rounded-md border p-2"
                />
              </label>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              {editing && error && locked && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => window.location.reload()}
                >
                  Reopen saved snapshot
                </Button>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={retake}>
                  Retake
                </Button>
                <Button
                  disabled={
                    busy || !validChatTarget(target) || (editing && !savedReady)
                  }
                  onClick={() => void share()}
                >
                  {busy ? "Sending…" : locked ? "Retry send" : "Send snapshot"}
                </Button>
              </div>
            </>
          ) : (
            <>
              {phase === "screen" ? (
                <p className="text-sm">
                  For the live document editor, choose this browser tab in the
                  screen picker. Sharing stops as soon as the image is captured.
                </p>
              ) : (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={release}>
                  Cancel
                </Button>
                <Button onClick={screenCapture}>Capture screen</Button>
                <Button
                  variant="outline"
                  onClick={() => screenshotInput.current?.click()}
                >
                  Choose screenshot
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
