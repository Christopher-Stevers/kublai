"use client";

import { use } from "react";

import { ToolDetail } from "~/components/assets/ToolDetail";

export default function AssetToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ToolDetail id={id} />;
}
