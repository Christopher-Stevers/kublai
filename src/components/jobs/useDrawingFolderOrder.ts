"use client";
import { useSyncExternalStore } from "react";

// Folder order is a per-device preference, like page mode. "Most used" counts
// how often this device has opened each folder.
export type DrawingFolderOrder = "used" | "az";
const ORDER_KEY = "foremanhq:drawing-folder-order";
const OPENS_KEY = "foremanhq:drawing-folder-opens";
const EVENT = "foremanhq:drawing-folder-order";

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
function readOrder(): DrawingFolderOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === "az" ? "az" : "used";
  } catch {
    return "used";
  }
}
function readOpensRaw() {
  try {
    return localStorage.getItem(OPENS_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}
function parseOpens(raw: string): Record<string, number> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object"
      ? (value as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

export function recordDrawingFolderOpen(folderId: string) {
  const opens = parseOpens(readOpensRaw());
  opens[folderId] = (opens[folderId] ?? 0) + 1;
  try {
    localStorage.setItem(OPENS_KEY, JSON.stringify(opens));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useDrawingFolderOrder() {
  const order = useSyncExternalStore(
    subscribe,
    readOrder,
    () => "used" as const,
  );
  const opensRaw = useSyncExternalStore(subscribe, readOpensRaw, () => "{}");
  const setOrder = (value: DrawingFolderOrder) => {
    try {
      localStorage.setItem(ORDER_KEY, value);
    } catch {
      return;
    }
    window.dispatchEvent(new Event(EVENT));
  };
  /** Most opened first (ties keep the server order), or A–Z by name. */
  const sortFolders = <T extends { id: string; name: string }>(
    folders: T[],
  ) => {
    if (order === "az")
      return [...folders].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    const opens = parseOpens(opensRaw);
    return folders
      .map((folder, index) => ({ folder, index }))
      .sort(
        (a, b) =>
          (opens[b.folder.id] ?? 0) - (opens[a.folder.id] ?? 0) ||
          a.index - b.index,
      )
      .map(({ folder }) => folder);
  };
  return { order, setOrder, sortFolders };
}
