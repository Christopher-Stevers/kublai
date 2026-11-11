"use client";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { SnapshotSourceContext } from "~/components/chat/SnapshotSourceContext";
import { notify } from "~/components/ui/app-dialogs";
import { FeatureErrorBoundary } from "~/components/app/FeatureErrorBoundary";
import { useDrawingAccount } from "./DrawingAccountProvider";
import type {
  DestinationRequest,
  DestinationResume,
  DestinationSession,
  DestinationSessionRequest,
} from "./drawing-destination-session";
export type { DestinationRequest } from "./drawing-destination-session";

function readRawSession(key: string | null) {
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw && raw.length <= 1_000_000 ? raw : null;
  } catch {
    return null;
  }
}
const loadPicker = () =>
  import("./DrawingDestinationPicker").then(({ DestinationPicker }) => ({
    default: DestinationPicker,
  }));
function DestinationPickerPanel(props: {
  request: DestinationSessionRequest;
  onFinish: (saved: boolean) => void;
  isCurrent: () => boolean;
}) {
  const [Picker, setPicker] = useState(() => lazy(loadPicker));
  return (
    <FeatureErrorBoundary
      allowReload={false}
      onRetry={() => setPicker(() => lazy(loadPicker))}
    >
      <Suspense
        fallback={
          <p role="status" data-snapshot-ui>
            Loading destination controls…
          </p>
        }
      >
        <Picker {...props} />
      </Suspense>
    </FeatureErrorBoundary>
  );
}

const Context = createContext<{
  start: (request: DestinationRequest) => boolean;
  resume: DestinationResume | null;
  consumed: () => void;
  active: boolean;
} | null>(null);
export const useDrawingDestination = () => useContext(Context);
type RestoreStatus = "checking" | "unbound" | "loading" | "ready" | "error";

/** Account changes create a new controller; ordinary route changes keep it mounted. */
export function DrawingDestinationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = useDrawingAccount();
  const accountKey = account?.accountKey.length ? account.accountKey : null;
  return (
    <DestinationController
      key={accountKey ?? "unbound"}
      accountKey={accountKey}
    >
      {children}
    </DestinationController>
  );
}
function DestinationController({
  children,
  accountKey,
}: {
  children: React.ReactNode;
  accountKey: string | null;
}) {
  const registry = useContext(SnapshotSourceContext);
  const router = useRouter();
  const storageKey = accountKey
    ? `foremanhq:destination-picker:${accountKey}`
    : null;
  const restoreGeneration = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>(
    storageKey ? "checking" : "unbound",
  );
  const [session, setSession] = useState<DestinationSession | null>(null);
  useEffect(() => {
    const generation = ++restoreGeneration.current;
    let cancelled = false;
    setSession(null);
    if (!storageKey) {
      setRestoreStatus("unbound");
      return;
    }
    const raw = readRawSession(storageKey);
    if (!raw) {
      setRestoreStatus("ready");
      return;
    }
    setRestoreStatus("loading");
    void import("./drawing-destination-session-validation")
      .then(({ parseStoredDestinationSession }) => {
        if (
          cancelled ||
          !mounted.current ||
          restoreGeneration.current !== generation
        )
          return;
        setSession(parseStoredDestinationSession(raw));
        setRestoreStatus("ready");
      })
      .catch(() => {
        if (
          !cancelled &&
          mounted.current &&
          restoreGeneration.current === generation
        )
          setRestoreStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey, restoreAttempt]);
  const request = session?.phase === "picking" ? session.request : null;
  const resume = session?.phase === "resume" ? session.request : null;
  const commit = (next: DestinationSession | null) => {
    if (!storageKey || !mounted.current) return;
    try {
      if (next) {
        // The workspace cache supplies the base record after a full page load.
        const draft = structuredClone(next.request.draft);
        if (draft.data.links?.length === 0) delete draft.data.links;
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            ...next,
            request: { ...next.request, baseEntity: undefined, draft },
          }),
        );
      } else window.sessionStorage.removeItem(storageKey);
    } catch {
      /* Continue browsing when session storage is unavailable. */
    }
    setSession(next);
  };
  const finish = (saved: boolean) => {
    if (!mounted.current || !request) return;
    commit({ phase: "resume", request: { ...request, saved } });
    router.push(request.returnTo.href, { scroll: false });
  };
  return (
    <Context.Provider
      value={{
        start: (next) => {
          if (!mounted.current) return false;
          if (!storageKey) {
            notify(
              "Your workspace is still loading. Try again shortly.",
              "error",
            );
            return false;
          }
          if (restoreStatus !== "ready") {
            notify(
              restoreStatus === "error"
                ? "Retry restoring your saved destination before starting another selection."
                : "Restoring your saved destination. Try again shortly.",
              "error",
            );
            return false;
          }
          if (!registry || request) return false;
          try {
            const returnTo = registry.captureSource();
            commit({
              phase: "picking",
              request: {
                ...next,
                draft: structuredClone(next.draft),
                returnTo,
              },
            });
            notify(
              "Navigate to your destination, then tap the check mark. Hold it to cancel.",
            );
            return true;
          } catch (reason) {
            notify(
              reason instanceof Error
                ? reason.message
                : "Could not start destination selection.",
              "error",
            );
            return false;
          }
        },
        resume,
        consumed: () => commit(null),
        active:
          Boolean(request) || Boolean(storageKey && restoreStatus !== "ready"),
      }}
    >
      {children}
      {storageKey && restoreStatus === "loading" && (
        <p role="status" data-snapshot-ui>
          Restoring saved destination…
        </p>
      )}
      {storageKey && restoreStatus === "error" && (
        <div role="alert" data-snapshot-ui>
          <p>
            Your saved destination could not load. Its draft is still on this
            device.
          </p>
          <button
            type="button"
            onClick={() => setRestoreAttempt((value) => value + 1)}
          >
            Retry saved destination
          </button>
        </div>
      )}
      {request && (
        <DestinationPickerPanel
          key={storageKey}
          request={request}
          onFinish={finish}
          isCurrent={() => Boolean(storageKey && mounted.current)}
        />
      )}
    </Context.Provider>
  );
}
