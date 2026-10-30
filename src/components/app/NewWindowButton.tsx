"use client";
import { useContext, useState } from "react";
import { PanelsTopLeftIcon } from "lucide-react";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { Button } from "~/components/ui/button";

export function NewWindowButton({ className }: { className?: string }) {
  const registry = useContext(SnapshotSourceContext);
  const [blocked, setBlocked] = useState(false);
  const open = () => {
    let href = window.location.href;
    try {
      href = registry?.captureSource().href ?? href;
    } catch {
      /* The current route remains usable without view-state capture. */
    }
    // A fresh target for every click. Open synchronously with the user gesture;
    // detach the opener before loading the same-origin application.
    const width = Math.min(1200, window.screen.availWidth || 1200);
    const height = Math.min(900, window.screen.availHeight || 900);
    const next = window.open(
      "",
      "_blank",
      `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=yes`,
    );
    setBlocked(!next);
    if (!next) return;
    next.opener = null;
    next.location.replace(href);
    next.focus();
  };
  return (
    <>
      <Button
        variant="ghost"
        className={className}
        onClick={open}
        title="Open This Page In A New Window"
      >
        <PanelsTopLeftIcon className="size-4" />
        New Window
      </Button>
      {blocked && (
        <div
          role="alert"
          className="bg-card fixed top-20 right-4 z-[100] max-w-sm rounded-xl border p-4 text-sm shadow-lg"
        >
          Allow pop-ups for ForemanHQ, then select New Window again.
          <Button variant="ghost" size="sm" onClick={() => setBlocked(false)}>
            Dismiss
          </Button>
        </div>
      )}
    </>
  );
}
