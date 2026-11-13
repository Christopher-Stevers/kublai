"use client";
import { useClerk, useSession } from "@clerk/nextjs";
import { useEffect, useSyncExternalStore } from "react";
import { bindSyncSession, getSyncSessionStatus, retrySyncSession, subscribeSyncSession } from "~/lib/sync-session";

export function SyncSessionRecovery() {
  const clerk = useClerk();
  const { session, isLoaded } = useSession();
  const status = useSyncExternalStore(subscribeSyncSession, getSyncSessionStatus, () => "ready" as const);
  const sessionId = session?.id;
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!isLoaded) return;
    return bindSyncSession({ userId, refresh: async () => {
      const current = clerk.session;
      if (!current || current.id !== sessionId) return null;
      const token = await current.getToken({ skipCache: true });
      return clerk.session?.id === sessionId ? token : null;
    } });
  }, [clerk, isLoaded, sessionId, userId]);
  useEffect(() => {
    const resume = () => {
      if (navigator.onLine && document.visibilityState === "visible") void retrySyncSession();
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  if (status === "ready") return null;
  return <aside role="status" className="fixed inset-x-3 top-20 z-[100] mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-xl border bg-background p-3 text-sm shadow-lg">
    <div className="min-w-0 flex-1">
      <p className="font-semibold">{status === "sign-in-required" ? "Sign in again to sync" : status === "refreshing" ? "Reconnecting…" : "Sync couldn’t finish"}</p>
      <p className="text-muted-foreground">Unsynced material changes stay on this device.</p>
    </div>
    {status === "sign-in-required" && <button type="button" className="rounded-lg border px-3 py-2" onClick={() => { void clerk.redirectToSignIn({ redirectUrl: window.location.href }); }}>Sign in</button>}
    {status !== "refreshing" && <button type="button" className="rounded-lg border px-3 py-2" onClick={() => { void retrySyncSession(); }}>Retry</button>}
  </aside>;
}
