"use client";
import { useSyncExternalStore } from "react";
import {
  drawingDownloadQueue,
  type DrawingDownloadTask,
} from "~/lib/drawing-download-queue";
const empty: DrawingDownloadTask[] = [];
export const useDrawingDownloads = () =>
  useSyncExternalStore(
    drawingDownloadQueue.subscribe,
    drawingDownloadQueue.getSnapshot,
    () => empty,
  );
