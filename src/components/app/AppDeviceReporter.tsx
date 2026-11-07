"use client";
import { useEffect } from "react";
import { api } from "~/trpc/react";
import { useInstallPrompt, isStandaloneApp } from "~/lib/install-prompt";
import {
  appDevicePlatform,
  getAppDeviceId,
  appDeviceType,
} from "~/lib/app-devices";
import { useOnlineStatus } from "~/hooks/use-online-status";

export function AppDeviceReporter({ userId }: { userId: string }) {
  const { installed } = useInstallPrompt();
  const online = useOnlineStatus();
  const report = api.appDevices.report.useMutation({ retry: false });
  const mutateAsync = report.mutateAsync;
  useEffect(() => {
    if (!online || userId === "guest") return;
    let lastSent = 0,
      lastState = "",
      pending = false,
      stopped = false;
    const send = async () => {
      if (stopped || pending || document.visibilityState !== "visible") return;
      const button = document.querySelector<HTMLElement>(
        "[data-app-install-button]",
      );
      const rect = button?.getBoundingClientRect();
      const shown = Boolean(
        button &&
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth &&
        getComputedStyle(button).visibility !== "hidden",
      );
      let deviceId: string;
      try {
        deviceId = getAppDeviceId();
      } catch {
        return;
      }
      const payload = {
        deviceId,
        deviceType: appDeviceType(
          navigator.userAgent,
          navigator.maxTouchPoints,
        ),
        platform: appDevicePlatform(
          navigator.userAgent,
          navigator.maxTouchPoints,
        ),
        mode: isStandaloneApp()
          ? ("installed-app" as const)
          : ("browser" as const),
        installButtonVisible: shown,
      };
      const state = JSON.stringify(payload);
      if (state === lastState && Date.now() - lastSent < 120_000) return;
      pending = true;
      try {
        await mutateAsync(payload);
        lastState = state;
        lastSent = Date.now();
      } catch {
        /* Retry on the next visible visit; reporting never blocks work. */
      } finally {
        pending = false;
      }
    };
    const trigger = () => {
      void send();
    };
    const frame = requestAnimationFrame(trigger);
    window.addEventListener("focus", trigger);
    window.addEventListener("pageshow", trigger);
    document.addEventListener("visibilitychange", trigger);
    const interval = setInterval(trigger, 15 * 60_000);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      clearInterval(interval);
      window.removeEventListener("focus", trigger);
      window.removeEventListener("pageshow", trigger);
      document.removeEventListener("visibilitychange", trigger);
    };
  }, [online, userId, installed, mutateAsync]);
  return null;
}
