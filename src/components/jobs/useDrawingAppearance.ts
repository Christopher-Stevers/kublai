"use client";
import { useState, useSyncExternalStore } from "react";
import {
  DEFAULT_DRAWING_APPEARANCE,
  drawingAppearance,
  readDrawingAppearance,
  writeDrawingAppearance,
  type DrawingAppearance,
} from "~/lib/drawing-appearance";

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useDrawingAppearance() {
  const client = useSyncExternalStore(
    subscribe,
    clientSnapshot,
    serverSnapshot,
  );
  const [appearance, setAppearance] = useState(readDrawingAppearance);
  const changeAppearance = (value: DrawingAppearance) => {
    const next = drawingAppearance(value);
    setAppearance(next);
    writeDrawingAppearance(next);
  };
  return [
    client ? appearance : DEFAULT_DRAWING_APPEARANCE,
    changeAppearance,
  ] as const;
}
