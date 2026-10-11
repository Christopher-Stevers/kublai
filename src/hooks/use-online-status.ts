"use client";

import { useEffect, useState } from "react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";

export function getBrowserOnlineStatus() {
  return typeof navigator === "undefined" || navigator.onLine;
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
  return sandbox ? true : isOnline;
}
