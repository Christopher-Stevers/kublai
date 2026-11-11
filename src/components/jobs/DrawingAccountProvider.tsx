"use client";
import {
  startDeviceQueryCache,
  wipeDeviceQueryCaches,
} from "~/lib/device-query-cache";
import { requestPersistentDeviceStorage } from "~/lib/persistent-device-storage";
import { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";
import {
  DrawingOfflineStore,
  setDrawingOfflineAccount,
} from "~/lib/drawing-offline";
import { clearPdfDocuments } from "~/lib/pdf-client";
import { clearDrawingTextIndexes } from "~/lib/drawing-text";
import { clearPrivateBackgroundWork } from "~/lib/private-background-work";

type DrawingAccount = {
  userId: string;
  accountKey: string;
  store: DrawingOfflineStore | null;
};
const Context = createContext<DrawingAccount | null>(null);
function clearPrivateMemory() {
  clearPrivateBackgroundWork();
  clearPdfDocuments();
  clearDrawingTextIndexes();
}
function isDrawingQuery(query: Query) {
  const path = query.queryKey[0];
  return (
    Array.isArray(path) &&
    (path[0] === "drawings" ||
      path[0] === "drawingsWorkspace" ||
      path[0] === "rooms")
  );
}

export function DrawingAccountProvider({
  userId,
  organizationId,
  children,
  simulationId,
  preserveAccountKey,
}: {
  userId: string;
  organizationId: string;
  children: React.ReactNode;
  simulationId?: string;
  preserveAccountKey?: string;
}) {
  const accountKey = `${organizationId}:${userId}${simulationId ? `:simulation:${simulationId}` : ""}`;
  const queryClient = useQueryClient();
  const [value, setValue] = useState<DrawingAccount | null>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    let disposed = false;
    let store: DrawingOfflineStore | undefined;
    clearPrivateMemory();
    void requestPersistentDeviceStorage();
    const clearQueries = () => {
      void queryClient.cancelQueries({ predicate: isDrawingQuery });
      queryClient.removeQueries({ predicate: isDrawingQuery });
    };
    clearQueries();
    const deviceCache = startDeviceQueryCache(queryClient, accountKey);
    const bindNavigation = (account: string | null) => {
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.controller?.postMessage({
          type: "FOREMENHQ_NAVIGATION_ACCOUNT",
          account,
        });
    };
    // Scope Flight payloads to the JS build that authenticated this document.
    const scripts = Array.from(document.scripts, (script) => script.src).filter(
      (src) => src.includes("/_next/static/"),
    );
    const buildFiles = scripts.filter((src) =>
      /(?:webpack|main-app)[-./]/.test(src),
    );
    const build = (buildFiles.length ? buildFiles : scripts).sort().join("|");
    let fingerprint = 2166136261;
    for (const character of build)
      fingerprint = Math.imul(fingerprint ^ character.charCodeAt(0), 16777619);
    const bindController = () => {
      if (!disposed && build)
        bindNavigation(`${accountKey}:build:${fingerprint >>> 0}`);
    };
    bindController();
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        bindController,
      );
    const flushDeviceCache = () => deviceCache.flush();
    window.addEventListener("pagehide", flushDeviceCache);
    const invalidate = () => {
      disposed = true;
      bindNavigation(null);
      void deviceCache.stop(true);
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
    void setDrawingOfflineAccount(accountKey, preserveAccountKey)
      .then(() => {
        if (disposed) return;
        store = new DrawingOfflineStore(accountKey);
        setValue({ userId, accountKey, store });
      })
      .catch(() => {
        // Disabled/quota-limited storage must not prevent authenticated online use.
        if (!disposed) setValue({ userId, accountKey, store: null });
      });
    return () => {
      bindNavigation(null);
      void deviceCache.stop();
      window.removeEventListener("pagehide", flushDeviceCache);
      if ("serviceWorker" in navigator)
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          bindController,
        );
      disposed = true;
      clearPrivateMemory();
      clearQueries();
      store?.dispose();
      window.removeEventListener(
        "foremanhq-drawing-account-invalidated",
        invalidate,
      );
    };
  }, [accountKey, userId, queryClient, preserveAccountKey]);
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
export const lockDrawingDownloadsOnSignOut = () => {
  clearPrivateMemory();
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("foremanhq-drawing-account-invalidated"));
  return Promise.all([setDrawingOfflineAccount(null), wipeDeviceQueryCaches()]);
};
