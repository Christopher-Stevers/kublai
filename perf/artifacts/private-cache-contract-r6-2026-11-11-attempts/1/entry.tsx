// Separate functional contract fixture. Never imported by the application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DrawingAccountProvider,
  lockDrawingDownloadsOnSignOut,
  useDrawingAccount,
} from "~/components/jobs/DrawingAccountProvider";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Bound() {
  const account = useDrawingAccount();
  return <output id="bound">{account?.accountKey ?? "unbound"}</output>;
}
function App() {
  const [session, setSession] = useState({ user: (window as Window & { __contractUser?: string }).__contractUser ?? "A", revision: 0 });
  // Only the explicitly synthetic session endpoint is substituted. Provider,
  // QueryClient, private stores, revocation generations and SW are real R6.
  Object.assign(window, {
    contract: {
      async login(user: string) {
        await fetch(`/fixture/session?user=${user}`, { method: "POST" });
        setSession(old => ({ user, revision: old.revision + 1 }));
      },
      async logout() {
        await fetch("/fixture/session", { method: "POST" });
        await lockDrawingDownloadsOnSignOut();
        setSession(old => ({ user: "", revision: old.revision + 1 }));
      },
      async flight(tree = "tree-A", prefetch = false, route = "/jobs") {
        const response = await fetch(`${route}?_rsc=contract`, {
          headers: { RSC: "1", "Next-Router-State-Tree": tree,
            "Next-Url": "/jobs", ...(prefetch ? { "Next-Router-Prefetch": "1" } : {}) },
        });
        return { status: response.status, text: await response.text() };
      },
      async warm(build: string) {
        const controller = navigator.serviceWorker.controller;
        if (!controller) throw Error("No controlling worker");
        return new Promise((resolve, reject) => {
          const channel = new MessageChannel();
          const timeout = setTimeout(() => { channel.port1.close(); reject(Error("Warm timeout")); }, 65_000);
          channel.port1.onmessage = event => {
            clearTimeout(timeout); channel.port1.close(); resolve(event.data);
          };
          controller.postMessage({ type: "FOREMENHQ_WARM_RELEASE", build, goodLink: true }, [channel.port2]);
        });
      },
    },
  });
  return <QueryClientProvider client={client}>
    {session.user ? <DrawingAccountProvider key={session.revision} userId={session.user} organizationId="fixture-org">
      <Bound />
    </DrawingAccountProvider> : <output id="bound">signed-out</output>}
  </QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<App />);
void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
