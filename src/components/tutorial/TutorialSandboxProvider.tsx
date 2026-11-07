"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "~/server/api/root";
import { api } from "~/trpc/react";
import { TutorialSandboxContext } from "./tutorial-sandbox-context";
import { createTutorialSandbox, type SandboxRuntime } from "./tutorial-sandbox-runtime";

export function sandboxLink(runtime: Pick<SandboxRuntime, "request">): TRPCLink<AppRouter> {
  return () => ({ op }) => observable(observer => {
    let cancelled = false;
    void runtime.request(op.path, op.input).then(data => {
      if (cancelled) return;
      observer.next({ result: { data } });
      observer.complete();
    }, (error: unknown) => {
      if (!cancelled) observer.error(TRPCClientError.from(error instanceof Error ? error : new Error(String(error))));
    });
    return () => { cancelled = true; };
  });
}

function ReadySandbox({ runtime, children }: { runtime: SandboxRuntime; children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }));
  const [client] = useState(() => api.createClient({ links: [sandboxLink(runtime)] }));
  useEffect(() => () => { queryClient.clear(); }, [queryClient]);
  return <TutorialSandboxContext.Provider value={runtime}>
    <QueryClientProvider client={queryClient}>
      <api.Provider client={client} queryClient={queryClient}>{children}</api.Provider>
    </QueryClientProvider>
  </TutorialSandboxContext.Provider>;
}

export function TutorialSandboxProvider({ userId, children, fallback }: { userId: string; children: ReactNode; fallback?: ReactNode }) {
  const [runtime, setRuntime] = useState<SandboxRuntime | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let cancelled = false;
    let current: SandboxRuntime | undefined;
    void createTutorialSandbox(userId).then(created => {
      if (cancelled) { void created.close(); return; }
      current = created;
      setRuntime(created);
    }, (reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error("Practice mode could not start"));
    });
    return () => { cancelled = true; if (current) void current.close(); };
  }, [userId]);
  if (error) {
    if (fallback) return <>{fallback}<p role="alert" className="p-4">{error.message}</p></>;
    throw error;
  }
  if (!runtime || runtime.userId !== userId) return fallback ?? <p role="status" className="p-6">Preparing your practice job…</p>;
  return <ReadySandbox key={runtime.runId} runtime={runtime}>{children}</ReadySandbox>;
}
