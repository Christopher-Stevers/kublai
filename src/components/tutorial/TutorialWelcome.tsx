"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, HardHat, ShieldCheck } from "lucide-react";
import { Button } from "~/components/ui/button";
import styles from "./TutorialExperience.module.css";
import { TUTORIAL_CHAPTERS } from "./tutorial-chapters";

/** First screen of the tour: what you'll do, and that it's all practice data. */
export function TutorialWelcome({
  onStart,
  onSkip,
}: {
  onStart: () => void;
  onSkip: () => void;
}) {
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => start.current?.focus(), []);
  return (
    <div
      className={`${styles.welcomeBackdrop} fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:items-center`}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-welcome-title"
        className={`${styles.welcome} bg-card text-card-foreground w-full max-w-md overflow-hidden rounded-3xl shadow-2xl`}
      >
        <div className="bg-primary text-primary-foreground relative overflow-hidden px-6 pt-7 pb-6">
          {/* Soft highlights behind the badge. */}
          <div
            aria-hidden="true"
            className="absolute -top-16 -right-10 size-48 rounded-full bg-white/10"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-20 -left-12 size-44 rounded-full bg-white/5"
          />
          <span className="relative flex size-14 items-center justify-center rounded-2xl bg-white/15 shadow-inner">
            <HardHat aria-hidden="true" className="size-8" />
          </span>
          <h2
            id="tutorial-welcome-title"
            className="relative mt-4 text-2xl font-bold tracking-tight"
          >
            Welcome to ForemanHQ
          </h2>
          <p className="text-primary-foreground/85 relative mt-1 text-sm">
            A quick hands-on tour of a practice job. It takes about two
            minutes.
          </p>
        </div>
        <ol className="space-y-3 px-6 pt-5">
          {TUTORIAL_CHAPTERS.map((chapter, index) => (
            <li key={chapter.phase} className="flex items-start gap-3">
              <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                <chapter.icon aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0 pt-0.5">
                <p className="text-sm font-semibold">
                  {index + 1}. {chapter.label}
                </p>
                <p className="text-muted-foreground text-sm">{chapter.intro}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground mx-6 mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
          Everything here is practice data. Your real jobs aren&apos;t touched.
        </p>
        <div className="space-y-2 px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <Button
            ref={start}
            size="lg"
            className="h-12 w-full text-base"
            onClick={onStart}
          >
            Start the tour
            <ArrowRight aria-hidden="true" className="ml-1 size-5" />
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground w-full"
            onClick={onSkip}
          >
            Skip for now
          </Button>
        </div>
      </section>
    </div>
  );
}
