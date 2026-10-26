"use client";
import { useEffect, useState } from "react";
import { WifiOffIcon } from "lucide-react";
import {
  isOfflineTestEnabled,
  setOfflineTestEnabled,
} from "~/lib/offline-test";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
export function OfflineTestSettings() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setEnabled(isOfflineTestEnabled()), []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <WifiOffIcon className="size-5" />
          Offline testing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex cursor-pointer items-center justify-between gap-4 font-medium">
          Offline test mode
          <input
            type="checkbox"
            role="switch"
            aria-label="Offline test mode"
            checked={enabled}
            disabled={busy}
            className="size-5"
            onChange={async (event) => {
              const next = event.target.checked;
              setBusy(true);
              setError("");
              try {
                await setOfflineTestEnabled(next);
                setEnabled(next);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not change offline mode.",
                );
                setBusy(false);
              }
            }}
          />
        </label>
        <p className="text-muted-foreground text-sm">
          Block ForemanHQ’s internet requests to test downloaded drawings, saved
          data and offline changes. Other apps stay connected.
        </p>
        <p className="text-muted-foreground text-sm">
          Reloads all ForemanHQ tabs in this browser. Finish any uploads first.
          Turn this off here or use Reconnect at the top of the app; pending
          offline changes can then sync.
        </p>
        {busy && (
          <p role="status" className="text-sm">
            {enabled ? "Reconnecting…" : "Preparing offline mode…"}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
