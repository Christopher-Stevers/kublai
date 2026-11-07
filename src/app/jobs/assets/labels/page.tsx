"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { LabelSheet } from "~/components/assets/LabelSheet";

function Labels() {
  const ids = (useSearchParams().get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return <LabelSheet ids={ids} />;
}

export default function AssetLabelsPage() {
  return (
    <Suspense>
      <Labels />
    </Suspense>
  );
}
