"use client";

import { use } from "react";

import { RequestDetail } from "~/components/assets/RequestDetail";

export default function AssetRequestPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  return <RequestDetail orderId={orderId} />;
}
