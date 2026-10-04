"use client";

import { useState } from "react";
import { DashboardClient } from "~/app/dashboard/DashboardClient";
import { Header } from "~/app/_components/Header";
import { Button } from "~/components/ui/button";
import { TutorialSandboxProvider } from "./TutorialSandboxProvider";
import { TutorialOverlay } from "./TutorialOverlay";
import { TutorialWelcome } from "./TutorialWelcome";

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
  const [started, setStarted] = useState(false);
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
      {started ? (
        <TutorialOverlay onFinish={onFinish} error={error} />
      ) : (
        <TutorialWelcome
          onStart={() => setStarted(true)}
          onSkip={() => onFinish("skipped")}
        />
      )}
    </TutorialSandboxProvider>
  );
}
