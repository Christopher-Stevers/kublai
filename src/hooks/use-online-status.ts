"use client";

import { isOfflineTestEnabled } from "~/lib/offline-test";
import { useEffect, useState } from "react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";

export function getBrowserOnlineStatus() {
  return !isOfflineTestEnabled() && (typeof navigator === "undefined" || navigator.onLine);
}

export function useOnlineStatus() {
  const sandbox = useTutorialSandbox();
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus);
  useEffect(() => {
    const update = () => setIsOnline(getBrowserOnlineStatus());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return sandbox && !isOfflineTestEnabled() ? true : isOnline;
}
