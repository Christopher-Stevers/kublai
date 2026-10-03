"use client";

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { resetJobWorkspaceNavigation } from "~/hooks/use-job-workspace-navigation";
import {
  readTutorialProgress,
  writeTutorialProgress,
  type TutorialOutcome,
  type TutorialProgress,
} from "~/lib/tutorial-progress";
import { TutorialExperience } from "./TutorialExperience";

const TutorialContext = createContext<{ restart: () => void } | null>(null);
export function useTutorial() {
  return useContext(TutorialContext);
}

class TutorialBoundary extends Component<
  { children: ReactNode; onEnd: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert" className="mx-auto max-w-md space-y-4 p-6">
        <p>
          The tutorial could not load. You can end it and try again from
          Settings.
        </p>
        <Button onClick={this.props.onEnd}>End tutorial</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}

/** The real app is not mounted while the entirely local demo is active. */
export function TutorialGate({
  userId,
  initialCompleted,
  children,
}: {
  userId: string;
  initialCompleted: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const utils = api.useUtils();
  const [active, setActive] = useState<boolean | null>(null);
  const [run, setRun] = useState(0);
  const [openingJobs, setOpeningJobs] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = useRef<TutorialProgress | null>(null);
  const mounted = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const sync = useCallback(
    (record: TutorialProgress) => {
      // Serialize reset/finish writes. An old request can never acknowledge a new run.
      queue.current = queue.current
        .catch(() => undefined)
        .then(async () => {
          if (
            !mounted.current ||
            current.current?.token !== record.token ||
            !current.current.pending
          )
            return;
          try {
            if (record.status === "active")
              await utils.client.user.restartTutorial.mutate({
                expectedUserId: userId,
              });
            else
              await utils.client.user.finishTutorial.mutate({
                outcome: record.status,
                expectedUserId: userId,
              });
            if (!mounted.current || current.current?.token !== record.token)
              return;
            const saved = { ...record, pending: false };
            current.current = saved;
            writeTutorialProgress(userId, saved);
            setSaveError(null);
          } catch {
            if (mounted.current && current.current?.token === record.token)
              setSaveError(
                "Tutorial progress will sync when a connection is available.",
              );
          }
        });
    },
    [userId, utils.client],
  );

  useEffect(() => {
    mounted.current = true;
    const stored = readTutorialProgress(userId);
    current.current = stored;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const localActive = stored?.status === "active";
    // A cached layout can disagree with a successfully saved local action. Resolve
    // that disagreement once, before mounting either workspace, with a bounded
    // live read. Offline/slow reads use local progress and never interrupt a run.
    if (
      stored &&
      !stored.pending &&
      localActive === initialCompleted &&
      navigator.onLine
    ) {
      void Promise.race([
        utils.client.user.getTutorialState
          .query()
          .then((state) =>
            state.userId === userId ? !state.completedAt : localActive,
          )
          .catch(() => localActive),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(localActive), 1500);
        }),
      ]).then((nextActive) => {
        if (timer) clearTimeout(timer);
        if (!cancelled) setActive(nextActive);
      });
    } else {
      setActive(stored ? localActive : !initialCompleted);
    }
    if (stored?.pending) sync(stored);
    const retry = () => {
      if (current.current?.pending) sync(current.current);
    };
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      mounted.current = false;
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
    // Server props initialize each account's gate once; router refreshes must not
    // replace a running practice session with a stale completion snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (active && pathname !== "/dashboard") router.replace("/dashboard");
  }, [active, pathname, router]);

  useEffect(() => {
    if (openingJobs && pathname === "/dashboard") {
      resetJobWorkspaceNavigation();
      setOpeningJobs(false);
    }
  }, [openingJobs, pathname]);

  const restart = () => {
    const record: TutorialProgress = {
      status: "active",
      pending: true,
      token: crypto.randomUUID(),
    };
    current.current = record;
    writeTutorialProgress(userId, record);
    setSaveError(null);
    setOpeningJobs(false);
    setActive(true);
    setRun((value) => value + 1);
    resetJobWorkspaceNavigation();
    router.replace("/dashboard");
    sync(record);
  };
  const finish = (outcome: TutorialOutcome) => {
    const record: TutorialProgress = {
      status: outcome,
      pending: true,
      token: crypto.randomUUID(),
    };
    current.current = record;
    writeTutorialProgress(userId, record);
    setActive(false);
    setOpeningJobs(true);
    resetJobWorkspaceNavigation();
    router.replace("/dashboard");
    sync(record);
  };

  if (active === null)
    return (
      <div className="p-6" role="status">
        Opening ForemanHQ…
      </div>
    );
  if (active)
    return (
      <TutorialBoundary key={run} onEnd={() => finish("skipped")}>
        <TutorialExperience
          onFinish={finish}
          finishing={false}
          error={saveError}
        />
      </TutorialBoundary>
    );
  if (openingJobs)
    return (
      <div className="mx-auto max-w-md space-y-4 p-6">
        <p role="status">Tutorial ended. Opening your jobs…</p>
        <Button asChild>
          <a href="/dashboard">Open Jobs</a>
        </Button>
      </div>
    );
  return (
    <TutorialContext.Provider value={{ restart }}>
      {saveError && (
        <div role="status" className="bg-muted border-b px-4 py-2 text-sm">
          {saveError}
        </div>
      )}
      {children}
    </TutorialContext.Provider>
  );
}

export function RestartTutorialCard() {
  const tutorial = useTutorial();
  if (!tutorial) return null;
  return (
    <section
      aria-labelledby="tutorial-settings-heading"
      className="bg-card text-card-foreground space-y-3 rounded-xl border p-6 shadow-sm"
    >
      <h2 id="tutorial-settings-heading" className="font-semibold">
        Getting started
      </h2>
      <p className="text-muted-foreground text-sm">
        Practice material lists, Rooms, and Chat with a demo job.
      </p>
      <Button variant="outline" onClick={tutorial.restart}>
        Restart tutorial
      </Button>
    </section>
  );
}
