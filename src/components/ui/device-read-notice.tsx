"use client";
import { blocksCachedRead } from "~/hooks/use-tier-one-read-options";

export function DeviceReadNotice({
  query,
}: {
  query: { data: unknown; error: unknown };
}) {
  return query.error && query.data !== undefined && !blocksCachedRead(query) ? (
    <p role="status" className="text-muted-foreground text-sm">
      Showing saved data. Reopen this view or reconnect to retry the refresh.
    </p>
  ) : null;
}
