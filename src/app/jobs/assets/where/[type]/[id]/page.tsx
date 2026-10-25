"use client";

import { use } from "react";
import { notFound } from "next/navigation";

import { HolderView } from "~/components/assets/HolderView";

const TYPES = ["location", "job", "user"] as const;

export default function AssetHolderPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = use(params);
  const holderType = TYPES.find((t) => t === type);
  if (!holderType) notFound();
  return <HolderView holder={{ type: holderType, id: decodeURIComponent(id) }} />;
}
