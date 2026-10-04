"use client";

import { DashboardClient } from "~/app/dashboard/DashboardClient";
import { Header } from "~/app/_components/Header";
import { Button } from "~/components/ui/button";
import { TutorialSandboxProvider } from "./TutorialSandboxProvider";
import { TutorialOverlay } from "./TutorialOverlay";

/** Normal production components, with isolated practice data and a guidance overlay. */
export function TutorialExperience({
  userId,
  onFinish,
  error,
}: {
  userId: string;
  onFinish: (outcome: "completed" | "skipped") => void;
  error?: string | null;
}) {
  return (
    <TutorialSandboxProvider
      userId={userId}
      fallback={
        <div className="mx-auto max-w-md space-y-4 p-6">
          <p role="status">Opening your practice job…</p>
          <Button onClick={() => onFinish("skipped")}>End tutorial</Button>
        </div>
      }
    >
      <div className="bg-muted/50 flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">
          <DashboardClient initialJobs={[]} />
        </main>
      </div>
      <TutorialOverlay onFinish={onFinish} error={error} />
    </TutorialSandboxProvider>
  );
}
