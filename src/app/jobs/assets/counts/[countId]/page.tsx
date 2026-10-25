"use client";

import { use } from "react";

import { CountDetail } from "~/components/assets/CountsView";

export default function AssetCountPage({ params }: { params: Promise<{ countId: string }> }) {
  const { countId } = use(params);
  return <CountDetail countId={countId} />;
}
