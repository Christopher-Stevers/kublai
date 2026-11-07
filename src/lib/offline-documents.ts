import type { RouterOutputs } from "~/trpc/react";

export type OfflineQuotes = RouterOutputs["materialList"]["listQuotes"];
export type OfflineOrders = RouterOutputs["materialList"]["listOrders"];

interface OfflineEnvelope<T> {
  version: 1;
  updatedAt: string;
  data: T;
}

const QUOTES_STORAGE_KEY = "foremanhq.offline.quotes";
const ORDERS_STORAGE_KEY = "foremanhq.offline.orders";

function readEnvelope<T>(key: string): OfflineEnvelope<T> | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OfflineEnvelope<T>;
  } catch {
    return null;
  }
}

function writeEnvelope<T>(key: string, data: T) {
  if (typeof window === "undefined") return;

  const envelope: OfflineEnvelope<T> = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data,
  };

  window.localStorage.setItem(key, JSON.stringify(envelope));
}

export function getOfflineQuotes() {
  return readEnvelope<OfflineQuotes>(QUOTES_STORAGE_KEY);
}

export function setOfflineQuotes(data: OfflineQuotes) {
  writeEnvelope(QUOTES_STORAGE_KEY, data);
}

export function getOfflineOrders() {
  return readEnvelope<OfflineOrders>(ORDERS_STORAGE_KEY);
}

export function setOfflineOrders(data: OfflineOrders) {
  writeEnvelope(ORDERS_STORAGE_KEY, data);
}
