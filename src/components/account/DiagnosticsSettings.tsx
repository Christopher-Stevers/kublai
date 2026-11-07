"use client";
import { useEffect, useState } from "react";
import { useDrawingAccount } from "~/components/jobs/DrawingAccountProvider";
import { diagnosticsEnabled, diagnosticStorageKey } from "~/lib/diagnostics";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
type Summary = {
  kind: string;
  feature: string;
  device: string;
  release: string;
  code: string;
  duration: string;
  reports: number;
};
export function DiagnosticsSettings() {
  const account = useDrawingAccount();
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<Summary[] | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    // Read the device preference only after hydration.
    setEnabled(account ? diagnosticsEnabled(account.accountKey) : false);
  }, [account]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy &amp; diagnostics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!account}
            onChange={(event) => {
              if (!account) return;
              try {
                window.localStorage.setItem(
                  diagnosticStorageKey(account.accountKey),
                  event.target.checked ? "on" : "off",
                );
                setEnabled(event.target.checked);
                setMessage("Preference saved.");
              } catch {
                setMessage("Could not save this preference.");
              }
            }}
          />
          Automatically report technical problems
        </label>
        <p className="text-muted-foreground text-sm">
          Reports failed app actions, initial loading that lasts over a minute,
          and repeated taps on job cards. Sends only feature, error category,
          app version, touch or desktop device type, and a duration range. No
          drawings, messages, entered text, screenshots, recordings, or browsing
          history are collected by this feature.
        </p>
        <p className="text-muted-foreground text-sm">
          Enabled by default for this account on this device. Turn it off here
          to stop sending new reports. Reports are combined into daily company
          counts without user identities; managers with company-settings access
          can review the last 30 days. Older counts are removed when reports
          arrive. Counts describe possible problems, not unique people or
          confirmed bugs.
        </p>
        <Button
          variant="outline"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setMessage("");
            try {
              const response = await fetch("/api/diagnostics");
              if (!response.ok)
                throw Error(
                  response.status === 403
                    ? "Company-settings permission is needed to view reports."
                    : "Reports could not be loaded.",
                );
              const data = (await response.json()) as { rows: Summary[] };
              setRows(data.rows);
            } catch (error) {
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Reports could not be loaded.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? "Loading reports…" : "View company problem summary"}
        </Button>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {rows && (
          <div className="space-y-2">
            {rows.length === 0 ? (
              <p>No reports in the last 30 days.</p>
            ) : (
              rows.map((row, i) => (
                <div key={i} className="rounded border p-3 text-sm">
                  <strong>
                    {row.feature} · {row.kind.replaceAll("_", " ")} ·{" "}
                    {row.reports} reports
                  </strong>
                  <p>
                    {row.device} · {row.code} ·{" "}
                    {row.duration.replaceAll("_", " ")} · version {row.release}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
