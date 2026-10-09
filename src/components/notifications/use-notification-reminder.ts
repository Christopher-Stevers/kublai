"use client";

import { useEffect, useState } from "react";
import { NOTIFICATION_REMINDER_MS } from "~/lib/app-notifications";

export function useNotificationReminder(unreadCount: number, open: boolean) {
  const [ring, setRing] = useState(0);
  useEffect(() => {
    if (unreadCount <= 0 || open) return;
    const remind = () => {
      if (document.visibilityState === "visible") setRing((value) => value + 1);
    };
    remind();
    const timer = window.setInterval(remind, NOTIFICATION_REMINDER_MS);
    document.addEventListener("visibilitychange", remind);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", remind);
    };
  }, [unreadCount, open]);
  return ring;
}
