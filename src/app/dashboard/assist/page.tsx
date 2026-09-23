import { Suspense } from "react";
import { AssistancePanel } from "~/components/assist/AssistancePanel";
export default function AssistancePage() {
  return (
    <Suspense fallback={<p className="p-6">Loading AI assistance…</p>}>
      <AssistancePanel />
    </Suspense>
  );
}
