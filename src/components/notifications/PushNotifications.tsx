"use client";

import { useEmployeeSimulation } from "~/components/simulation/SimulationProvider";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, BellOff } from "lucide-react";
import { api } from "~/trpc/react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { SwitchTrack } from "~/components/ui/switch";
import { pushDeviceType } from "~/lib/member-notifications";

const STORAGE_KEY = "foremanhq-chat-push-device-v1";
const DEVICE_EVENT = "foremanhq-chat-push-device-change";
type StoredDevice = {
  userId: string;
  account: string;
  endpoint: string;
  revokeToken: string;
  revoked?: boolean;
};
function readDevice(): StoredDevice | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "userId" in value &&
      "account" in value &&
      "endpoint" in value &&
      "revokeToken" in value &&
      typeof value.userId === "string" &&
      typeof value.account === "string" &&
      typeof value.endpoint === "string" &&
      typeof value.revokeToken === "string"
    )
      return value as StoredDevice;
  } catch {
    /* Private storage may be unavailable. Enabling reports that separately. */
  }
  return null;
}
function writeDevice(device: StoredDevice | null) {
  const next = device ? JSON.stringify(device) : null;
  if (localStorage.getItem(STORAGE_KEY) === next) return;
  if (next) localStorage.setItem(STORAGE_KEY, next);
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(DEVICE_EVENT));
}
function supported() {
  return (
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
async function registration() {
  const registered = await navigator.serviceWorker.getRegistration("/");
  if (registered?.active) return registered;
  await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "The notification service is still starting. Try again shortly.",
            ),
          ),
        8000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
let workerBindingQueue: Promise<void> = Promise.resolve();
function setWorkerAccount(account: string | null) {
  const expectedToken = readDevice()?.revokeToken ?? null;
  const operation = workerBindingQueue
    .catch(() => undefined)
    .then(() => persistWorkerAccount(account, expectedToken));
  workerBindingQueue = operation;
  return operation;
}
async function persistWorkerAccount(
  requestedAccount: string | null,
  expectedToken: string | null,
) {
  const device = readDevice();
  if ((device?.revokeToken ?? null) !== expectedToken) return;
  const account =
    device && !device.revoked && device.account === requestedAccount
      ? requestedAccount
      : null;
  if (!("serviceWorker" in navigator)) return;
  const reg = account
    ? await registration()
    : await navigator.serviceWorker.getRegistration("/");
  if (!reg && !account) return;
  const worker = reg?.active ?? navigator.serviceWorker.controller;
  if (!worker && !account) return;
  if (!worker)
    throw new Error(
      "The notification service is not ready. Reload and try again.",
    );
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Update the app and try enabling notifications again."));
    }, 4000);
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean }>) => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data?.ok) resolve();
      else
        reject(
          new Error("Notification storage is unavailable on this device."),
        );
    };
    worker.postMessage({ type: "FOREMANHQ_PUSH_ACCOUNT", account }, [
      channel.port2,
    ]);
  });
}
async function revoke(device: StoredDevice) {
  const response = await fetch("/api/trpc/push.revokeDevice", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: { endpoint: device.endpoint, revokeToken: device.revokeToken },
    }),
    keepalive: true,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok)
    throw new Error(
      "Could not remove this notification device from the server. Reconnect and try again.",
    );
}

/** Called before sign-out as well as on account changes. Never reassign an existing opt-in silently. */
let disconnectInFlight: Promise<void> | null = null;
let enrollmentGeneration = 0;
export function disconnectPushDevice() {
  enrollmentGeneration++;
  disconnectInFlight ??= disconnectDevice().finally(() => {
    disconnectInFlight = null;
  });
  return disconnectInFlight;
}
async function disconnectDevice() {
  const device = readDevice();
  let storageFailure: unknown;
  try {
    if (device) writeDevice({ ...device, revoked: true });
  } catch (error) {
    storageFailure = error;
  }
  const results = await Promise.allSettled([
    setWorkerAccount(null),
    (async () => {
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration("/");
      const subscription = await reg?.pushManager?.getSubscription();
      if (subscription && !(await subscription.unsubscribe()))
        throw new Error(
          "The browser could not disable notifications. Check its notification settings.",
        );
    })(),
    device ? revoke(device) : Promise.resolve(),
  ]);
  // Retain the revoke capability after a network failure; the global binding retries it.
  if (results[2]?.status === "fulfilled") {
    try {
      const current = readDevice();
      if (
        current?.revokeToken === device?.revokeToken &&
        current?.endpoint === device?.endpoint
      )
        writeDevice(null);
    } catch (error) {
      storageFailure = error;
    }
  }
  const failed = results.find(
    (item): item is PromiseRejectedResult => item.status === "rejected",
  );
  if (failed)
    throw failed.reason instanceof Error
      ? failed.reason
      : new Error(
          "Could not completely disable notifications. Please try again.",
        );
  if (storageFailure)
    throw new Error(
      "Could not clear saved notification settings on this device.",
    );
}

export function PushAccountBinding() {
  const report = api.push.reportDevice.useMutation();
  const reportedDevice = useRef<string | null>(null);
  const pathname = usePathname();
  const identity = api.push.identity.useQuery(undefined, {
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60000,
    retry: false,
  });
  const [revision, setRevision] = useState(0);
  const reportDevice = report.mutateAsync;
  useEffect(() => {
    const device = readDevice();
    if (
      !device ||
      device.revoked ||
      !identity.data?.eligible ||
      device.userId !== identity.data.userId ||
      !("Notification" in window) ||
      Notification.permission !== "granted" ||
      reportedDevice.current === device.revokeToken
    )
      return;
    reportedDevice.current = device.revokeToken;
    void reportDevice({
      endpoint: device.endpoint,
      revokeToken: device.revokeToken,
      deviceType: pushDeviceType(navigator.userAgent, navigator.maxTouchPoints),
    }).catch(() => {
      if (reportedDevice.current === device.revokeToken)
        reportedDevice.current = null;
    });
  }, [identity.data, revision, reportDevice]);
  const { refetch } = identity;
  useEffect(() => {
    const changed = () => {
      void refetch().then(() => setRevision((value) => value + 1));
    };
    window.addEventListener("storage", changed);
    window.addEventListener(DEVICE_EVENT, changed);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener(DEVICE_EVENT, changed);
    };
  }, [refetch]);
  useEffect(() => {
    void refetch();
  }, [pathname, refetch]);
  useEffect(() => {
    if (!identity.data || !("serviceWorker" in navigator)) return;
    const device = readDevice();
    if (!device) {
      void setWorkerAccount(null).catch(() => undefined);
      return;
    }
    if (
      device.revoked ||
      device.userId !== identity.data.userId ||
      !identity.data.eligible
    ) {
      // Another tab may have signed into a new account. A cached identity must never
      // revoke that tab's new opt-in. Re-read authentication and the device generation.
      void refetch()
        .then(({ data: fresh }) => {
          const current = readDevice();
          if (!fresh || current?.revokeToken !== device.revokeToken) return;
          if (
            current.revoked ||
            current.userId !== fresh.userId ||
            !fresh.eligible
          )
            return disconnectPushDevice();
          return setWorkerAccount(current.account);
        })
        .catch(() => {
          /* Retained revocations retry on the next online/focus check. */
        });
    } else void setWorkerAccount(device.account).catch(() => undefined);
  }, [identity.data, refetch, revision]);
  return null;
}

export function PushNotifications() {
  const simulation = useEmployeeSimulation();
  const isOnline = useOnlineStatus();
  const identity = api.push.identity.useQuery(undefined, {
    staleTime: 30000,
    retry: false,
  });
  const subscribe = api.push.subscribe.useMutation();
  const utils = api.useUtils();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [error, setError] = useState("");
  useEffect(() => {
    setAvailable(supported());
    setEnabled(false);
    setChecking(supported());
    if (!supported()) return;
    let cancelled = false;
    let inspection = 0;
    const inspect = async () => {
      const generation = ++inspection;
      setChecking(true);
      setPermission(Notification.permission);
      const device = readDevice();
      const reg = await navigator.serviceWorker.getRegistration("/");
      const current = await reg?.pushManager?.getSubscription();
      let subscribed = false;
      if (
        current &&
        device &&
        !device.revoked &&
        device.userId === identity.data?.userId
      ) {
        subscribed = (
          await utils.push.device.fetch({ endpoint: current.endpoint })
        ).subscribed;
      }
      if (!cancelled && generation === inspection) {
        setEnabled(subscribed && Notification.permission === "granted");
        setChecking(false);
      }
    };
    const inspectSafely = () => {
      void inspect().catch(() => {
        if (!cancelled) {
          setChecking(false);
          setError(
            "Could not check notification settings. Reconnect and try again.",
          );
        }
      });
    };
    inspectSafely();
    window.addEventListener("focus", inspectSafely);
    window.addEventListener(DEVICE_EVENT, inspectSafely);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", inspectSafely);
      window.removeEventListener(DEVICE_EVENT, inspectSafely);
    };
  }, [identity.data?.userId, utils]);

  const toggle = async () => {
    if (simulation || busy || checking || !available || (!isOnline && !enabled))
      return;
    setError("");
    setBusy(true);
    let newlyCreated: PushSubscription | null = null;
    let device: StoredDevice | null = null;
    const generation = enrollmentGeneration;
    const requireCurrentOperation = () => {
      if (generation !== enrollmentGeneration)
        throw new Error(
          "Notification setup was cancelled because the account or device changed. Try again.",
        );
    };
    try {
      if (enabled) {
        await disconnectPushDevice();
        setEnabled(false);
        return;
      }
      if (!identity.data?.userId || !identity.data.publicKey)
        throw new Error("Notifications are not configured yet.");
      const expectedUserId = identity.data.userId;
      // Permission is requested directly from this button gesture, never on mount.
      const granted = await Notification.requestPermission();
      requireCurrentOperation();
      setPermission(granted);
      if (granted !== "granted")
        throw new Error(
          granted === "denied"
            ? "Notifications are blocked. Allow them in this site's browser settings."
            : "Notifications were not enabled. You can try again when ready.",
        );
      // A previous account's delayed cleanup must finish before creating a replacement.
      if (disconnectInFlight) await disconnectInFlight;
      requireCurrentOperation();
      // Test durable device storage before creating a server subscription.
      localStorage.setItem(`${STORAGE_KEY}-check`, "1");
      localStorage.removeItem(`${STORAGE_KEY}-check`);
      const reg = await registration();
      requireCurrentOperation();
      const old = await reg.pushManager.getSubscription();
      const previous = readDevice();
      if (old && (previous?.userId !== expectedUserId || previous.revoked)) {
        await disconnectPushDevice();
        throw new Error(
          "The previous notification account was disconnected. Tap enable again for this account.",
        );
      }
      requireCurrentOperation();
      const bytes = Uint8Array.from(
        atob(identity.data.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
        (char) => char.charCodeAt(0),
      );
      const current = await reg.pushManager.getSubscription();
      const browserSubscription =
        current ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      if (!current) newlyCreated = browserSubscription;
      requireCurrentOperation();
      const json = browserSubscription.toJSON();
      if (!json.keys?.p256dh || !json.keys.auth)
        throw new Error("The browser did not provide notification keys.");
      const result = await subscribe.mutateAsync({
        endpoint: browserSubscription.endpoint,
        deviceType: pushDeviceType(
          navigator.userAgent,
          navigator.maxTouchPoints,
        ),
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      device = { ...result, endpoint: browserSubscription.endpoint };
      requireCurrentOperation();
      const freshIdentity = await utils.push.identity.fetch();
      requireCurrentOperation();
      if (
        result.userId !== expectedUserId ||
        freshIdentity.userId !== expectedUserId ||
        !freshIdentity.eligible
      )
        throw new Error(
          "Your account changed. Try again in the account you want to notify.",
        );
      writeDevice(device);
      await setWorkerAccount(result.account);
      requireCurrentOperation();
      if (readDevice()?.revokeToken !== device.revokeToken)
        throw new Error(
          "The notification device changed. Try enabling it again.",
        );
      setEnabled(true);
    } catch (failure) {
      // Revoke the returned capability itself: it may arrive after logout, before
      // it was saved, or after a newer account has replaced the local record.
      if (device) {
        const current = readDevice();
        if (current?.revokeToken === device.revokeToken) {
          try {
            writeDevice({ ...device, revoked: true });
          } catch {
            /* Still revoke server-side. */
          }
          await setWorkerAccount(null).catch(() => undefined);
        }
        await revoke(device)
          .then(() => {
            if (readDevice()?.revokeToken === device?.revokeToken)
              writeDevice(null);
          })
          .catch(() => undefined);
      }
      const active = readDevice();
      if (
        newlyCreated &&
        (!active ||
          active.revoked ||
          active.revokeToken === device?.revokeToken)
      )
        await newlyCreated.unsubscribe().catch(() => undefined);
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not change notifications. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const missingConfig = Boolean(
    identity.data?.eligible && !identity.data.publicKey,
  );
  const blocked = permission === "denied";
  const status =
    checking || identity.isPending
      ? "Checking this device…"
      : !available
        ? "Push notifications aren’t supported in this browser. On iPhone, open the app from your Home Screen."
        : blocked && !enabled
          ? "Notifications are blocked. Allow them in this site’s browser settings."
          : missingConfig && !enabled
            ? "Push notifications aren’t configured yet."
            : !identity.data?.eligible
              ? "Push notifications are available to approved organization members."
              : !isOnline && !enabled
                ? "Connect to turn push notifications on."
                : enabled
                  ? "On for this device."
                  : "Off for this device.";
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
        >
          {enabled ? <Bell size={20} /> : <BellOff size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Push notifications</p>
          <p className="text-muted-foreground text-xs" role="status">
            {status}
          </p>
        </div>
        <button
          type="button"
          className="focus-visible:ring-ring -mr-1 inline-flex min-h-11 min-w-14 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          onClick={() => void toggle()}
          disabled={
            Boolean(simulation) ||
            busy ||
            checking ||
            (!isOnline && !enabled) ||
            !available ||
            identity.isPending ||
            identity.isError ||
            !identity.data?.eligible ||
            (missingConfig && !enabled) ||
            (blocked && !enabled)
          }
          aria-pressed={enabled}
          aria-label={
            busy
              ? "Updating push notifications…"
              : enabled
                ? "Turn push notifications off"
                : "Turn push notifications on"
          }
        >
          <SwitchTrack
            checked={enabled}
            className={busy ? "animate-pulse" : ""}
          />
        </button>
      </div>
      {simulation && (
        <p className="text-muted-foreground text-xs">
          Device notifications belong to your signed-in account. End simulation
          to change them.
        </p>
      )}
      {identity.isError && (
        <p role="alert">
          Could not load notification settings. Reconnect and try again.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
