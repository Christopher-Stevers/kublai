"use client";

import { Suspense } from "react";

import { ToolsView } from "~/components/assets/ToolsView";

export default function AssetToolsPage() {
  return (
    <Suspense>
      <ToolsView />
    </Suspense>
  );
}
