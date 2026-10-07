"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import {
  DrawingOfflineStore,
  setDrawingOfflineAccount,
} from "~/lib/drawing-offline";
import { clearPdfDocuments } from "~/lib/pdf-client";
import { clearDrawingTextIndexes } from "~/lib/drawing-text";

type DrawingAccount = { accountKey: string; store: DrawingOfflineStore | null };
const Context = createContext<DrawingAccount | null>(null);
function clearPrivateMemory() {
  clearPdfDocuments();
  clearDrawingTextIndexes();
}
function isDrawingQuery(query: Query) {
  const path = query.queryKey[0];
  return (
    Array.isArray(path) &&
    (path[0] === "drawings" || path[0] === "drawingsWorkspace")
  );
}

export function DrawingAccountProvider({
  userId,
  organizationId,
  children,
}: {
  userId: string;
  organizationId: string;
  children: React.ReactNode;
}) {
  const accountKey = `${organizationId}:${userId}`;
  const queryClient = useQueryClient();
  const [value, setValue] = useState<DrawingAccount | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let disposed = false;
    let store: DrawingOfflineStore | undefined;
    clearPrivateMemory();
    const clearQueries = () => {
      void queryClient.cancelQueries({ predicate: isDrawingQuery });
      queryClient.removeQueries({ predicate: isDrawingQuery });
    };
    clearQueries();
    const invalidate = () => {
      disposed = true;
      clearPrivateMemory();
      clearQueries();
      store?.dispose();
      setValue(null);
      setLocked(true);
    };
    window.addEventListener(
      "foremanhq-drawing-account-invalidated",
      invalidate,
    );
    void setDrawingOfflineAccount(accountKey)
      .then(() => {
        if (disposed) return;
        store = new DrawingOfflineStore(accountKey);
        setValue({ accountKey, store });
      })
      .catch(() => {
        // Disabled/quota-limited storage must not prevent authenticated online use.
        if (!disposed) setValue({ accountKey, store: null });
      });
    return () => {
      disposed = true;
      clearPrivateMemory();
      clearQueries();
      store?.dispose();
      window.removeEventListener(
        "foremanhq-drawing-account-invalidated",
        invalidate,
      );
    };
  }, [accountKey, queryClient]);
  if (locked)
    return (
      <main className="mx-auto max-w-lg space-y-3 p-6" role="alert">
        <h1 className="text-lg font-semibold">Your account changed</h1>
        <p>Reload to continue with the current account.</p>
        <button
          type="button"
          className="rounded border px-4 py-2"
          onClick={() => window.location.reload()}
        >
          Reload session
        </button>
      </main>
    );
  if (value?.accountKey !== accountKey)
    return (
      <p role="status" className="p-6">
        Opening your workspace…
      </p>
    );
  return (
    <Context.Provider key={accountKey} value={value}>
      {children}
    </Context.Provider>
  );
}
export const useDrawingAccount = () => useContext(Context);
export const clearDrawingDownloadsOnSignOut = () => {
  clearPrivateMemory();
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("foremanhq-drawing-account-invalidated"));
  return setDrawingOfflineAccount(null);
};
