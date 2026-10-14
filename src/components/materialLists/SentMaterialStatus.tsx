"use client";
import Link from "next/link";
import { LockKeyholeIcon } from "lucide-react";

export type SentMaterialOrder = {
  id: string;
  number: string | null;
  status: string;
  quantity: string;
  receivedQuantity: string;
  verificationStatus: string;
};

export function SentMaterialStatus({ order, materialListId, unit }: {
  order: SentMaterialOrder;
  materialListId: string;
  unit?: string | null;
}) {
  const ordered = Number(order.quantity), received = Number(order.receivedQuantity);
  const remaining = Math.max(0, ordered - received);
  const format = (value: number) => `${value.toLocaleString("en-CA", { maximumFractionDigits: 6 })}${unit ? ` ${unit}` : ""}`;
  const problem = order.verificationStatus === "problem";
  const label = order.status === "cancelled" ? "Cancelled" : problem ? "Delivery issue" : remaining === 0 ? "Delivered" : received > 0 ? "Part delivered" : "Awaiting delivery";
  return <div className="mt-2 space-y-1 rounded-md border p-2 text-xs">
    <Link className="flex items-center gap-1 underline underline-offset-2" href={`/dashboard/material-lists/${materialListId}?orderId=${order.id}`}>
      <LockKeyholeIcon className="h-3 w-3 shrink-0" />{order.number || "View order"}
    </Link>
    <p className={problem ? "text-red-600 dark:text-red-400" : remaining === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{label}</p>
    <p>Ordered: {format(ordered)}</p>
    <p>Received: {format(received)}</p>
    <p>Outstanding: {format(remaining)}</p>
  </div>;
}
