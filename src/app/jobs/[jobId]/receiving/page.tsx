"use client";
import { use, Suspense } from "react";
import { ReceivingWorkspace } from "~/components/materialLists/ReceivingWorkspace";
export default function Page({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  return (
    <Suspense fallback={<p className="p-6">Loading receiving queue…</p>}>
      <ReceivingWorkspace jobId={jobId} />
    </Suspense>
  );
}
