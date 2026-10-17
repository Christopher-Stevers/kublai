"use client";
import { useDrawingPageMode } from "../DrawingPageMode";
import { DrawingScrollPages } from "../DrawingScrollPages";
import { useEffect, useRef, useState } from "react";
import { MinimizeIcon } from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { useSnapshotSource } from "~/components/chat/SnapshotSourceContext";
import type { SnapshotState } from "~/lib/snapshot-source";
import { DrawingWorkspace } from "../DrawingWorkspace";
import { DrawingPageNavigation } from "../DrawingPageNavigation";
import { useDrawingFullscreen } from "../useDrawingFullscreen";
import type { DrawingViewport } from "../DrawingSheetViewer";

type Props = {
  jobId: string;
  versionId: string;
  initialView?: SnapshotState["pdf"];
  onReady?: () => void;
  onDocumentDetails?: () => void;
  onClose?: () => void;
};
export function DocumentDrawingWorkspace({
  jobId,
  versionId,
  initialView,
  onReady,
  onDocumentDetails,
  onClose,
}: Props) {
  const { scroll } = useDrawingPageMode();
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null);
  const {
    mutate,
    data: sheets,
    error,
    isPending,
  } = api.drawingsWorkspace.openDocument.useMutation();
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
  const ready = useRef(onReady);
  useEffect(() => {
    ready.current = onReady;
  }, [onReady]);
  useEffect(() => {
    mutate({ jobId, versionId });
  }, [jobId, versionId, mutate]);
  const actualIndex = Math.min(index, Math.max(0, (sheets?.length ?? 1) - 1));
  const sheet = sheets?.[actualIndex];
  useSnapshotSource("pdf", () => ({
    page: actualIndex + 1,
    zoom: viewport.current.zoom,
    viewport: viewport.current,
    left: 0,
    top: 0,
  }));
  const openPage = (next: number) => {
    const nextCamera = { center: { x: 0.5, y: 0.5 }, zoom: 1 };
    viewport.current = nextCamera;
    setCamera(nextCamera);
    setIndex(next);
  };
  return (
    <div
      ref={surface}
      className={`bg-background flex min-h-0 flex-1 flex-col ${fullscreen ? "fixed inset-0 z-[70] [&_[data-drawing-chrome]]:hidden" : "relative"}`}
      aria-label="Document drawing viewer"
    >
      {fullscreen && (
        <Button
          ref={exitButton}
          type="button"
          variant="outline"
          aria-label="Exit full screen"
          title="Exit full screen (Esc)"
          className="absolute top-[calc(0.75rem+env(safe-area-inset-top))] right-[calc(0.75rem+env(safe-area-inset-right))] z-50 size-11 rounded-xl shadow-md"
          onClick={exit}
        >
          <MinimizeIcon className="size-5" />
        </Button>
      )}
      {sheet ? (
        <>
          <div className="relative min-h-0 flex-1">
            <DrawingScrollPages enabled={scroll} sheets={sheets} index={actualIndex} onPage={openPage}>
            <DrawingWorkspace
              scrollPages={scroll}
              toolbarContainer={toolbarContainer}
              key={sheet.id}
              jobId={jobId}
              sheet={sheet}
              initialViewport={camera}
              onReady={() => ready.current?.()}
              onDocumentDetails={onDocumentDetails}
              onClose={onClose}
              onViewportChange={(value) => {
                viewport.current = value;
                if (zoomLabel.current)
                  zoomLabel.current.textContent = `${Math.round(value.zoom * 100)}%`;
              }}
              onOpenSheet={(target) => {
                const next = sheets.findIndex((item) => item.id === target.id);
                if (next >= 0) openPage(next);
              }}
            />
            </DrawingScrollPages>
          </div>
          <div ref={setToolbarContainer} data-drawing-chrome className="relative z-30 shrink-0" />
          <DrawingPageNavigation
            scrollPages={scroll}
            name={sheet.name}
            index={actualIndex}
            count={sheets.length}
            zoom={camera.zoom}
            zoomRef={zoomLabel}
            fullscreenRef={enterButton}
            onFullscreen={enter}
            onPrevious={() => openPage(actualIndex - 1)}
            onNext={() => openPage(actualIndex + 1)}
          />
        </>
      ) : (
        <div className="grid min-h-64 flex-1 place-content-center gap-3 p-6 text-center">
          <p role={error ? "alert" : "status"}>
            {error?.message ?? "Opening drawing workspace…"}
          </p>
          {error && (
            <Button
              disabled={isPending}
              onClick={() => mutate({ jobId, versionId })}
            >
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
