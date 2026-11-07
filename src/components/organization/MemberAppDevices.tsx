"use client";
import { Smartphone } from "lucide-react";
import type { AppDeviceObservation } from "~/lib/app-devices";
export type MemberAppDeviceState = {
  devices: AppDeviceObservation[];
  loading: boolean;
  unavailable: boolean;
};
export function MemberAppBadge({
  devices,
  loading,
  unavailable,
}: MemberAppDeviceState) {
  const label = unavailable
    ? "App status unavailable"
    : loading
      ? "Checking app status…"
      : devices.some((d) => d.installedAppLastSeenAt)
        ? "Installed app detected"
        : devices.length
          ? "Browser last seen"
          : "Unknown · no device report yet";
  return (
    <span className="text-muted-foreground mt-1.5 inline-flex items-center gap-1 text-[11px]">
      <Smartphone className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}
export function MemberAppDevices(props: MemberAppDeviceState) {
  return (
    <section
      aria-label="App installation and visibility"
      className="space-y-3 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">App and devices</h3>
        <MemberAppBadge {...props} />
      </div>
      <p className="text-muted-foreground text-xs">
        Reports begin when this member next opens ForemanHQ. Browser use does
        not prove the app is uninstalled. These are browser profiles; one
        physical device can have several.
      </p>
      {props.devices.map((d, index) => (
        <div
          key={d.deviceId}
          className="bg-muted/50 space-y-2 rounded-lg p-3 text-xs"
        >
          <p className="text-sm font-medium">
            {d.platform} · {d.deviceType} {index + 1}
          </p>
          <p>
            {d.mode === "installed-app"
              ? "Last opened as installed app"
              : "Last opened in browser"}
          </p>
          <p>
            Install button {d.installButtonVisible ? "shown" : "hidden"} on last
            check
          </p>
          <p className="text-muted-foreground">
            Last checked: {new Date(d.lastSeenAt).toLocaleString()}
          </p>
          {d.installedAppLastSeenAt && (
            <p className="text-muted-foreground">
              Installed app last detected:{" "}
              {new Date(d.installedAppLastSeenAt).toLocaleString()}
            </p>
          )}
        </div>
      ))}
      {!props.loading && !props.unavailable && !props.devices.length && (
        <p className="text-muted-foreground text-xs">
          No device report yet. Ask them to open ForemanHQ while online.
        </p>
      )}
      <p className="text-muted-foreground border-t pt-3 text-xs">
        “Shown” records that the install button was on screen, not that it was
        read. Clearing browser storage or using private browsing can create a
        new profile. Old reports do not confirm current installation or
        notification permissions.
      </p>
    </section>
  );
}
