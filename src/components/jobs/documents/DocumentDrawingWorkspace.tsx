"use client";
import { useDrawingPageMode } from "../DrawingPageMode";
import { scrollNeighbors } from "../drawing-scroll-pages";
import { useEffect, useRef, useState } from "react";
import { MinimizeIcon } from "lucide-react";
import { useRootFlag } from "~/hooks/use-root-flag";
import { Button } from "~/components/ui/button";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import type { SnapshotState } from "~/lib/snapshot-source";
import { useDrawingAccount } from "../DrawingAccountProvider";
import { useDocumentDrawingPages } from "./use-document-drawing-pages";
import { DrawingWorkspace } from "../DrawingWorkspace";
import { DrawingPageNavigation, DrawingZoomReadout, showZoomReadout } from "../DrawingPageNavigation";
import { useDrawingFullscreen } from "../useDrawingFullscreen";
import type { DrawingViewport } from "../DrawingSheetViewer";

type Props = {
  jobId: string;
  versionId: string;
  folderId?: string | null;
  initialView?: SnapshotState["pdf"];
  onReady?: () => void;
  onDocumentDetails?: () => void;
  onClose?: () => void;
};
export function DocumentDrawingWorkspace(props: Props) {
  const account = useDrawingAccount();
  if (!account?.organizationId) return <p role="status">Opening your workspace…</p>;
  return <DocumentDrawingWorkspaceContent key={`${account.accountKey}|${props.jobId}|${props.versionId}`} {...props} />;
}
function DocumentDrawingWorkspaceContent({
  jobId,
  versionId,
  folderId,
  initialView,
  onReady,
  onDocumentDetails,
  onClose,
}: Props) {
  const pageModeScope = `document-folder:${jobId}:${folderId ?? "root"}`;
  const { scroll } = useDrawingPageMode(pageModeScope);
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const {data: sheets, error, isPending, denied, retry, persist, online} = useDocumentDrawingPages(jobId, versionId);
  const [index, setIndex] = useState(Math.max(0, (initialView?.page ?? 1) - 1));
  const [camera, setCamera] = useState<DrawingViewport>(
    initialView?.viewport ?? {
      center: { x: 0.5, y: 0.5 },
      zoom: initialView?.zoom ?? 1,
    },
  );
  const viewport = useRef<DrawingViewport>(camera);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const { surface, fullscreen, exitButton, enterButton, enter, exit } =
    useDrawingFullscreen(true);
  const quickWheel = fullscreen;
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);
  const actualIndex = Math.min(index, Math.max(0, (sheets?.length ?? 1) - 1));
  const sheet = sheets?.[actualIndex];
  useRootFlag("data-drawing-quick-wheel-page", quickWheel && Boolean(sheet));
  useSnapshotSource("pdf", () => ({
    page: actualIndex + 1,
    zoom: viewport.current.zoom,
    viewport: viewport.current,
    left: 0,
    top: 0,
  }));
  const openPage = (next: number, nextCamera: DrawingViewport = { center: { x: 0.5, y: 0.5 }, zoom: 1 }) => {
    viewport.current = nextCamera;
    setCamera(nextCamera);
    setIndex(next);
  };
  return (
    <div
      ref={surface}
      data-drawing-fullscreen={fullscreen}
      data-drawing-quick-wheel={quickWheel && Boolean(sheet)}
      className={`bg-background flex min-h-0 flex-1 flex-col ${fullscreen ? "fixed inset-0 z-[70]" : "relative"}`}
      aria-label="Document drawing viewer"
    >
      {fullscreen && (
        <Button
          ref={exitButton}
          type="button"
          variant="outline"
          aria-label="Exit full screen"
          title="Exit full screen (Esc)"
          className="bg-background/60 border-border/60 hover:bg-background/80 absolute top-[calc(0.75rem+env(safe-area-inset-top))] left-3 z-50 size-10 rounded-full shadow-md backdrop-blur-sm"
          onClick={exit}
        >
          <MinimizeIcon className="size-5" />
        </Button>
      )}
      {sheet ? (
        <>
          {error && <p role="status" className="text-muted-foreground px-3 text-sm">Saved pages shown. Could not refresh: {error.message}</p>}
          {isPending && <p role="status" className="text-muted-foreground px-3 text-sm">Checking this document…</p>}
          <div className="relative min-h-0 flex-1">
            <DrawingWorkspace
              requireFreshDocumentRead
              pageModeScope={pageModeScope}
              scrollPages={scroll}
              scrollStack={scroll ? { ...scrollNeighbors(sheets, actualIndex), onPage: (offset, view) => openPage(actualIndex + offset, view) } : undefined}
              toolbarContainer={toolbarContainer}
              pageNavigation={{ index: actualIndex, count: sheets.length,
                onPrevious: () => { if (actualIndex > 0) openPage(actualIndex - 1); },
                onNext: () => { if (actualIndex < sheets.length - 1) openPage(actualIndex + 1); },
              }}
              fullscreenRef={enterButton}
              fullscreen={fullscreen}
              onFullscreen={fullscreen ? exit : enter}
              key={`workspace:${sheet.id}`}
              jobId={jobId}
              sheet={sheet}
              initialViewport={camera}
              onPrepareOffline={persist}
              onReady={() => ready.current?.()}
              onDocumentDetails={onDocumentDetails}
              onClose={onClose}
              onViewportChange={(value) => {
                viewport.current = value;
                showZoomReadout(zoomLabel.current, `${Math.round(value.zoom * 100)}%`);
              }}
              onOpenSheet={(target) => {
                const next = sheets.findIndex((item) => item.id === target.id);
                if (next >= 0) openPage(next);
              }}
            />
            {/* The viewer and readout are siblings: their keys must never collide. */}
            {!quickWheel && <DrawingZoomReadout key={`zoom:${sheet.id}`} zoom={viewport.current.zoom} zoomRef={zoomLabel} />}
          </div>
          <div ref={setToolbarContainer} data-drawing-chrome className="relative z-30 shrink-0" />
          {!quickWheel && <DrawingPageNavigation
            scrollPages={scroll}
            name={sheet.name}
            index={actualIndex}
            count={sheets.length}
            onPrevious={() => openPage(actualIndex - 1)}
            onNext={() => openPage(actualIndex + 1)}
          />}
        </>
      ) : (
        <div className="grid min-h-64 flex-1 place-content-center gap-3 p-6 text-center">
          <p role={error ? "alert" : "status"}>
            {error?.message ?? (online ? "Opening drawing workspace…" : "These document pages are not saved on this device. Connect to open them.")}
          </p>
          {(Boolean(error) || !online) && !denied && (
            <Button
              disabled={isPending || !online}
              onClick={retry}
            >
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
