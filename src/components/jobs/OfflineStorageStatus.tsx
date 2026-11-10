"use client";
import { useEffect, useState } from "react";
import { requestPersistentDeviceStorage } from "~/lib/persistent-device-storage";
export function OfflineStorageStatus() {
  const [protectedStorage, setProtected] = useState<boolean | null>(null);
  const check = () => requestPersistentDeviceStorage().then(setProtected);
  useEffect(() => { void check(); }, []);
  return <div className="text-muted-foreground text-xs" role="status">
    {protectedStorage === null ? "Checking offline storage protection…" : protectedStorage ? "Offline storage protected" : "Offline storage protection not granted"}
    {protectedStorage === false && <button className="ml-2 underline" onClick={() => void check()}>Request protection</button>}
    <p>Downloads stay on this device for your account until removed. Clearing site data removes them.</p>
  </div>;
}
