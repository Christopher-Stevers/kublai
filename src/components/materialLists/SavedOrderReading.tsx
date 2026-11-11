import type { ReceivingOrderReading } from "~/lib/receiving-order-reading";
/** Historical reading only: deliberately no controls, receipt totals or rights. */
export function SavedOrderReading({
  reading,
  refreshing,
  online,
}: {
  reading: ReceivingOrderReading;
  refreshing: boolean;
  online: boolean;
}) {
  return (
    <section
      aria-label="Saved order"
      className="mb-3 space-y-2 rounded-lg border p-3 text-sm"
    >
      <p className="font-semibold">Saved order</p>
      <p>
        {refreshing
          ? "Refreshing…"
          : online
            ? "Current order unavailable. Showing saved details."
            : "Offline. Showing saved details."}
      </p>
      <p>
        {reading.orderNumber ?? "Order"}
        {reading.supplierName ? ` · ${reading.supplierName}` : ""}
      </p>
      <p>Saved on this device: {new Date(reading.savedAt).toLocaleString()}</p>
      {reading.lines.length < reading.totalLines && (
        <p>
          Showing {reading.lines.length} of {reading.totalLines} saved lines.
        </p>
      )}
      <ul>
        {reading.lines.map((line) => (
          <li key={line.id}>
            {line.description ?? line.sku ?? "Order line"}
            {line.description && line.sku ? ` · ${line.sku}` : ""} — previous
            ordered quantity {line.ordered}
          </li>
        ))}
      </ul>
    </section>
  );
}
