"use client";
import { useSyncExternalStore } from "react";

// Folder and drawing order are per-device preferences, like page mode. "Most
// used" counts how often this device has opened each folder or drawing.
export type DrawingFolderOrder = "used" | "az";
export type DrawingSheetOrder = DrawingFolderOrder;

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

/** Most opened first; ties keep the given order. */
export function sortByOpens<T>(
  items: T[],
  idOf: (item: T) => string,
  opens: Record<string, number>,
) {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (opens[idOf(b.item)] ?? 0) - (opens[idOf(a.item)] ?? 0) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
}

function openOrderStore(name: string, fallback: DrawingFolderOrder) {
  const orderKey = `foremanhq:drawing-${name}-order`;
  const opensKey = `foremanhq:drawing-${name}-opens`;
  const event = `foremanhq:drawing-${name}-order`;
  const subscribe = (callback: () => void) => {
    window.addEventListener(event, callback);
    window.addEventListener("storage", callback);
    return () => {
      window.removeEventListener(event, callback);
      window.removeEventListener("storage", callback);
    };
  };
  const readOrder = (): DrawingFolderOrder => {
    try {
      const value = localStorage.getItem(orderKey);
      return value === "az" || value === "used" ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const readOpensRaw = () => {
    try {
      return localStorage.getItem(opensKey) ?? "{}";
    } catch {
      return "{}";
    }
  };
  const record = (id: string) => {
    const opens = parseOpens(readOpensRaw());
    opens[id] = (opens[id] ?? 0) + 1;
    try {
      localStorage.setItem(opensKey, JSON.stringify(opens));
    } catch {
      return;
    }
    window.dispatchEvent(new Event(event));
  };
  const useOrder = () => {
    const order = useSyncExternalStore(subscribe, readOrder, () => fallback);
    const opensRaw = useSyncExternalStore(subscribe, readOpensRaw, () => "{}");
    const setOrder = (value: DrawingFolderOrder) => {
      try {
        localStorage.setItem(orderKey, value);
      } catch {
        return;
      }
      window.dispatchEvent(new Event(event));
    };
    return { order, setOrder, opensRaw };
  };
  return { record, useOrder };
}

const folderStore = openOrderStore("folder", "used");
const sheetStore = openOrderStore("sheet", "az");

export const recordDrawingFolderOpen = folderStore.record;
export const recordDrawingSheetOpen = sheetStore.record;

export function useDrawingFolderOrder() {
  const { order, setOrder, opensRaw } = folderStore.useOrder();
  /** Most opened first (ties keep the server order), or A–Z by name. */
  const sortFolders = <T extends { id: string; name: string }>(
    folders: T[],
  ) =>
    order === "az"
      ? [...folders].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        )
      : sortByOpens(folders, (folder) => folder.id, parseOpens(opensRaw));
  return { order, setOrder, sortFolders };
}

/** Drawings default to A–Z by sheet number; "Most used" reorders by opens. */
export function useDrawingSheetOrder() {
  const { order, setOrder, opensRaw } = sheetStore.useOrder();
  const sortSheets = <T extends { id: string }>(sheetsInAzOrder: T[]) =>
    order === "az"
      ? sheetsInAzOrder
      : sortByOpens(sheetsInAzOrder, (sheet) => sheet.id, parseOpens(opensRaw));
  return { order, setOrder, sortSheets };
}
