"use client";

import { use } from "react";

import { ToolDetail } from "~/components/assets/ToolDetail";

/** Where a tool's QR label points: /dashboard/assets/scan/<tag>. */
export default function AssetScanPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = use(params);
  return <ToolDetail tag={decodeURIComponent(tag).toUpperCase()} />;
}
