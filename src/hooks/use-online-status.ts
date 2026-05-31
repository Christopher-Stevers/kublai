"use client";

import { useEffect, useState } from "react";

const DEV_OFFLINE_KEY = "foremenhq.dev.force-offline";
const DEV_OFFLINE_EVENT = "foremenhq:dev-offline-changed";
const isDevOfflineToggleEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_OFFLINE_TEST_TOGGLE === "true";

let navigatorOverrideInstalled = false;
let originalNavigatorOnlineDescriptor: PropertyDescriptor | undefined;

function isDevForcedOffline() {
  if (!isDevOfflineToggleEnabled || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEV_OFFLINE_KEY) === "true";
  } catch {
    return false;
  }
}

function readNativeNavigatorOnline() {
  if (typeof window === "undefined") return true;

  const getter = originalNavigatorOnlineDescriptor?.get;
  if (getter) return Boolean(getter.call(window.navigator));

  const value = originalNavigatorOnlineDescriptor?.value;
  if (typeof value === "boolean") return value;

  return true;
}

export function ensureDevNavigatorOnlineOverride() {
  if (!isDevOfflineToggleEnabled || typeof window === "undefined") return;
  if (navigatorOverrideInstalled) return;

  originalNavigatorOnlineDescriptor =
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.navigator), "onLine") ??
    Object.getOwnPropertyDescriptor(window.navigator, "onLine");

  try {
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      get: () => !isDevForcedOffline() && readNativeNavigatorOnline(),
    });
    navigatorOverrideInstalled = true;
  } catch {
    // Some browsers may refuse overriding navigator.onLine. The app-level
    // hooks still respect the dev override; direct navigator checks just fall
    // back to real browser connectivity.
  }
}

export function getBrowserOnlineStatus() {
  if (typeof window === "undefined") return true;
  ensureDevNavigatorOnlineOverride();
  return window.navigator.onLine && !isDevForcedOffline();
}

export function getDevOfflineOverride() {
  return isDevForcedOffline();
}

export function setDevOfflineOverride(enabled: boolean) {
  if (!isDevOfflineToggleEnabled || typeof window === "undefined") return;

  ensureDevNavigatorOnlineOverride();
  try {
    window.localStorage.setItem(DEV_OFFLINE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage can be unavailable in private/locked-down mobile browsers.
  }
  window.dispatchEvent(new Event(DEV_OFFLINE_EVENT));
  window.dispatchEvent(new Event(enabled ? "offline" : "online"));
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(getBrowserOnlineStatus);

  useEffect(() => {
    if (typeof window === "undefined") return;

    ensureDevNavigatorOnlineOverride();
    const updateOnlineStatus = () => setIsOnline(getBrowserOnlineStatus());
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    window.addEventListener(DEV_OFFLINE_EVENT, updateOnlineStatus);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      window.removeEventListener(DEV_OFFLINE_EVENT, updateOnlineStatus);
    };
  }, []);

  return isOnline;
}
