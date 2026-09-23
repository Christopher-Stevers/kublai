"use client";

import { useSyncExternalStore } from "react";
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

/**
 * In-app replacements for window.confirm/alert. Call `confirmAction` or
 * `notify` from anywhere; `AppDialogHost` (mounted once in the root layout)
 * renders them with the app's own dialog and styling.
 */

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Notice = {
  id: number;
  message: string;
  variant: "info" | "success" | "error";
};

type State = {
  confirm: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
  notices: Notice[];
};

let state: State = { confirm: null, notices: [] };
const listeners = new Set<() => void>();
let nextNoticeId = 1;

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Resolves true when the user confirms, false when they cancel or dismiss. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  // A new request replaces (and cancels) any dialog already open.
  state.confirm?.resolve(false);
  return new Promise((resolve) => {
    setState({ confirm: { ...options, resolve } });
  });
}

export function notify(
  message: string,
  variant: Notice["variant"] = "info",
  durationMs = 5000,
) {
  const id = nextNoticeId++;
  setState({ notices: [...state.notices, { id, message, variant }] });
  setTimeout(() => dismissNotice(id), durationMs);
}

function dismissNotice(id: number) {
  setState({ notices: state.notices.filter((notice) => notice.id !== id) });
}

function closeConfirm(ok: boolean) {
  state.confirm?.resolve(ok);
  setState({ confirm: null });
}

const noticeIcons = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  error: AlertCircleIcon,
};

export function AppDialogHost() {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  const confirm = current.confirm;

  return (
    <>
      <Dialog open={!!confirm} onOpenChange={(open) => !open && closeConfirm(false)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            {confirm?.description && (
              <DialogDescription className="whitespace-pre-line">
                {confirm.description}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => closeConfirm(false)}>
              {confirm?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={confirm?.destructive ? "destructive" : "default"}
              onClick={() => closeConfirm(true)}
            >
              {confirm?.confirmLabel ?? "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[100] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {current.notices.map((notice) => {
          const Icon = noticeIcons[notice.variant];
          return (
            <div
              key={notice.id}
              role={notice.variant === "error" ? "alert" : "status"}
              className="bg-card text-card-foreground animate-in fade-in slide-in-from-bottom-2 pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border p-3 text-sm shadow-lg"
            >
              <Icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  notice.variant === "error" && "text-destructive",
                  notice.variant === "success" && "text-success",
                  notice.variant === "info" && "text-primary",
                )}
              />
              <p className="flex-1">{notice.message}</p>
              <button
                type="button"
                onClick={() => dismissNotice(notice.id)}
                className="text-muted-foreground hover:text-foreground -m-1 p-1"
                aria-label="Dismiss"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
