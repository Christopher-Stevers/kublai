/** Each stage contributes one third; quantities weight lines within a stage. */
export function materialListProgress(
  rows: readonly {
    quantity: string | number | null;
    sentQuantity: string | number | null;
    receivedQuantity: string | number | null;
    sentOrderStatus: string | null;
    sentAt: Date | string | null;
    verificationStatus: string | null;
  }[],
) {
  const positive = (value: string | number | null) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  };
  let total = 0,
    sent = 0,
    delivered = 0,
    verified = 0;
  for (const row of rows) {
    const isSent =
      row.sentOrderStatus !== "cancelled" &&
      (!!row.sentAt ||
        ["sent", "confirmed", "received"].includes(row.sentOrderStatus ?? ""));
    const quantity = positive(isSent ? row.sentQuantity : row.quantity);
    total += quantity;
    if (!isSent) continue;
    sent += quantity;
    const received = Math.min(quantity, positive(row.receivedQuantity));
    delivered += received;
    if (row.verificationStatus === "complete" && received >= quantity)
      verified += quantity;
  }
  return total > 0 ? ((sent + delivered + verified) / (3 * total)) * 100 : 0;
}
