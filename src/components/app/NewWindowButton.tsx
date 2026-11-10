"use client";
import { useContext } from "react";
import { PanelsTopLeftIcon } from "lucide-react";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { Button } from "~/components/ui/button";
import { useAppPages } from "./AppPagesProvider";

export function NewWindowButton({
  className,
  onOpened,
}: {
  className?: string;
  onOpened?: () => void;
}) {
  const registry = useContext(SnapshotSourceContext);
  const pages = useAppPages();
  return (
    <Button
      variant="ghost"
      className={className}
      disabled={!pages}
      onClick={() => {
        let href = window.location.href;
        try {
          href = registry?.captureSource().href ?? href;
        } catch {
          /* Use current route. */
        }
        onOpened?.();
        pages?.open(href);
      }}
      title="Open this page inside ForemanHQ"
    >
      <PanelsTopLeftIcon className="size-4" />
      New Page
    </Button>
  );
}

export function PageSwitcherButton() {
  const pages = useAppPages();
  if (!pages || pages.count <= 1) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative size-11 shrink-0"
      aria-label={`Open pages (${pages.count})`}
      onClick={pages.show}
    >
      <PanelsTopLeftIcon className="size-5" />
      <span
        aria-hidden="true"
        className="bg-primary text-primary-foreground absolute top-0 right-0 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
      >
        {pages.count}
      </span>
    </Button>
  );
}
