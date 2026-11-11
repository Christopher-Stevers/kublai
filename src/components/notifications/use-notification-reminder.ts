"use client";
import { setPageInterval as setInterval, clearPageInterval as clearInterval } from "~/lib/app-page-activity";


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
    // The page interval reminds on its own when the page comes back, so a
    // second listener here counted every return twice.
    const timer = setInterval(remind, NOTIFICATION_REMINDER_MS);
    return () => clearInterval(timer);
  }, [unreadCount, open]);
  return ring;
}
