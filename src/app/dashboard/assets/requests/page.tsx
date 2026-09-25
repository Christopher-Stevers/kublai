"use client";

import { Suspense } from "react";

import { RequestsView } from "~/components/assets/RequestsView";

export default function AssetRequestsPage() {
  return (
    <Suspense>
      <RequestsView />
    </Suspense>
  );
}
