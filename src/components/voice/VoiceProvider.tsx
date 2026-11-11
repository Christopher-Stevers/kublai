"use client";
import { useDevFeatures } from "~/components/app/DevFeaturesProvider";
import { DevBadge } from "~/components/app/DevBadge";
import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { MicIcon } from "lucide-react";
import styles from "./voice.module.css";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { FeatureErrorBoundary } from "~/components/app/FeatureErrorBoundary";
export type Phase =
  | "off"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "paused"
  | "review";
export type VoiceState = {
  phase: Phase;
  level: number;
  start: () => void;
  stop: () => void;
  error: string;
};
export type VoiceControls = Pick<VoiceState, "start" | "stop">;
export type VoiceStatus = Omit<VoiceState, "start" | "stop">;
const VoiceContext = createContext<VoiceState | null>(null);
export const useVoice = () => useContext(VoiceContext);
const loadEngine = () => lazy(() => import("./VoiceEngine"));
export function DevVoiceProvider({ children }: { children: ReactNode }) {
  return useDevFeatures() ? (
    <VoiceProvider>{children}</VoiceProvider>
  ) : (
    children
  );
}
export function VoiceProvider({ children }: { children: ReactNode }) {
  const controls = useRef<VoiceControls | null>(null);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [Engine, setEngine] = useState(loadEngine);
  const start = useCallback(() => controls.current?.start(), []);
  const stop = useCallback(() => controls.current?.stop(), []);
  return (
    <VoiceContext.Provider value={status ? { ...status, start, stop } : null}>
      {children}
      <FeatureErrorBoundary
        allowReload={false}
        onRetry={() => setEngine(loadEngine)}
      >
        <Suspense fallback={null}>
          <Engine controls={controls} onStatus={setStatus} />
        </Suspense>
      </FeatureErrorBoundary>
    </VoiceContext.Provider>
  );
}
export function VoiceCard() {
  const voice = useVoice();
  const sandbox = useTutorialSandbox();
  if (!voice || sandbox) return null;
  const lit = voice.phase === "listening";
  const active = voice.phase !== "off";
  const toggle = active ? voice.stop : voice.start;
  const description = lit
    ? "Listening… Tap to end your session"
    : active
      ? `${voice.phase === "thinking" ? "Thinking…" : voice.phase === "speaking" ? "Speaking…" : "Voice is on"} Tap to end your session`
      : "Find parts. Open drawings. Get things done.";
  return (
    <div className="flex min-w-0 flex-col">
      <Card
        className={`${styles.card} flex-1 cursor-pointer transition-shadow hover:shadow-md`}
        role="button"
        tabIndex={0}
        data-lit={lit}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
        aria-label={active ? "End voice session" : "Start voice assistant"}
        aria-pressed={active}
      >
        <CardHeader>
          <CardTitle className="flex min-w-0 items-center gap-2 leading-tight break-words">
            Voice <DevBadge />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <MicIcon className="h-4 w-4 shrink-0" />
            <span>{description}</span>
          </div>
        </CardContent>
      </Card>
      {voice.error && !active && (
        <p role="alert" className={styles.cardError}>
          {voice.error}
        </p>
      )}
    </div>
  );
}
