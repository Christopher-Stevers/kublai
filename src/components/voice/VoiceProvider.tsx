"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  MicIcon,
  MicOffIcon,
  XIcon,
  ArrowUpIcon,
  Volume2Icon,
} from "lucide-react";
import { microphone, pcm16, type MicCapture } from "./audio";
import styles from "./voice.module.css";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
type Phase =
  | "off"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "paused"
  | "review";
type Result = {
  sessionId?: string;
  error?: string;
  transcript?: string;
  text?: string;
  href?: string;
  proposal?: { id: string; summary: string };
  speechId?: string;
};
type VoiceState = {
  phase: Phase;
  level: number;
  start: () => void;
  stop: () => void;
  error: string;
};
const VoiceContext = createContext<VoiceState | null>(null);
export const useVoice = () => useContext(VoiceContext);
export function VoiceProvider({ children }: { children: ReactNode }) {
  const router = useRouter(),
    pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("off"),
    [level, setLevel] = useState(0),
    [error, setError] = useState(""),
    [transcript, setTranscript] = useState(""),
    [answer, setAnswer] = useState(""),
    [draft, setDraft] = useState(""),
    [proposal, setProposal] = useState<Result["proposal"]>();
  const live = useRef<Phase>("off"),
    session = useRef(""),
    generation = useRef(0),
    mic = useRef<MicCapture | null>(null),
    player = useRef<AudioBufferSourceNode | null>(null),
    abort = useRef<AbortController | null>(null),
    page = useRef(pathname),
    frames = useRef<Float32Array[]>([]),
    preroll = useRef<Float32Array[]>([]),
    timing = useRef({ started: 0, lastVoice: 0, lastUI: 0, voiced: 0 }),
    turnRef = useRef<(audio: string) => void>(() => undefined);
  page.current = pathname;
  const transition = (p: Phase) => {
    live.current = p;
    setPhase(p);
    frames.current = [];
    preroll.current = [];
    timing.current.started = 0;
    timing.current.voiced = 0;
  };
  async function request(body: Record<string, unknown>, signal?: AbortSignal) {
    const r = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = (await r.json()) as Result;
    if (!r.ok) throw Error(data.error ?? "Voice request failed.");
    return data;
  }
  function stop() {
    generation.current++;
    abort.current?.abort();
    try {
      player.current?.stop();
    } catch {}
    player.current = null;
    mic.current?.close();
    mic.current = null;
    const id = session.current;
    session.current = "";
    if (id)
      void request({ action: "end", sessionId: id }).catch(() => undefined);
    transition("off");
    setLevel(0);
    setProposal(undefined);
  }
  // Unmount on account/simulation change ends the microphone and discards history.
  useEffect(
    () => () => {
      generation.current++;
      abort.current?.abort();
      mic.current?.close();
      try {
        player.current?.stop();
      } catch {}
    },
    [],
  );
  useEffect(() => {
    const hide = () => {
      if (document.hidden && live.current !== "off") {
        abort.current?.abort();
        try {
          player.current?.stop();
        } catch {}
        mic.current?.close();
        mic.current = null;
        transition("paused");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  async function start() {
    if (live.current !== "off" && live.current !== "paused") return;
    const g = ++generation.current;
    setError("");
    transition("connecting");
    try {
      const capture = await microphone((samples, rate) => {
        if (g !== generation.current) return;
        let energy = 0;
        for (const v of samples) energy += v * v;
        const rms = Math.sqrt(energy / samples.length),
          now = performance.now();
        if (now - timing.current.lastUI > 75) {
          setLevel(Math.min(1, rms * 12));
          timing.current.lastUI = now;
        }
        if (live.current !== "listening" && live.current !== "review") return;
        // Keep a brief lead-in so the first consonant is not clipped.
        preroll.current.push(samples);
        while (preroll.current.length > Math.ceil((rate * 0.25) / 128))
          preroll.current.shift();
        if (rms > 0.018) {
          timing.current.lastVoice = now;
          timing.current.voiced += samples.length / rate;
          if (!timing.current.started) {
            timing.current.started = now;
            frames.current = [...preroll.current];
          }
        }
        if (timing.current.started) {
          frames.current.push(samples);
          if (
            now - timing.current.lastVoice > 1000 ||
            now - timing.current.started > 20000
          ) {
            if (timing.current.voiced > 0.3) {
              const audio = pcm16(frames.current, rate);
              transition("thinking");
              turnRef.current(audio);
            } else {
              frames.current = [];
              timing.current.started = 0;
              timing.current.voiced = 0;
            }
          }
        }
      });
      if (g !== generation.current) {
        capture.close();
        return;
      }
      mic.current = capture;
      if (!session.current) {
        const result = await request({ action: "start" });
        if (g !== generation.current) {
          if (result.sessionId)
            void request({ action: "end", sessionId: result.sessionId });
          return;
        }
        session.current = result.sessionId!;
      }
      transition("listening");
    } catch (e) {
      if (g !== generation.current) return;
      mic.current?.close();
      mic.current = null;
      transition("off");
      setError(e instanceof Error ? e.message : "Microphone unavailable.");
    }
  }
  async function speak(id: string, g: number) {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "speech",
        sessionId: session.current,
        speechId: id,
      }),
      signal: abort.current?.signal,
    });
    if (!response.ok)
      throw Error("Spoken reply unavailable. The answer is shown below.");
    const buffer = await response.arrayBuffer();
    if (g !== generation.current || !mic.current) return;
    const context = mic.current.context;
    const decoded = await context.decodeAudioData(buffer);
    if (g !== generation.current) return;
    await context.resume();
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    player.current = source;
    transition("speaking");
    await new Promise<void>((resolve) => {
      source.onended = () => {
        source.disconnect();
        player.current = null;
        resolve();
      };
      source.start();
    });
  }
  async function turn(text?: string, audio?: string) {
    const g = generation.current;
    if (!session.current) return;
    setError("");
    setProposal(undefined);
    transition("thinking");
    abort.current = new AbortController();
    let pendingReview = false;
    try {
      const result = await request(
        {
          action: "turn",
          sessionId: session.current,
          text,
          audio,
          page: (() => {
            const w = (
              window.history.state as {
                foremenhqWorkspace?: { location?: unknown };
              } | null
            )?.foremenhqWorkspace?.location as
              | { jobId?: string; materialListId?: string; view?: string }
              | undefined;
            return page.current === "/jobs" && w?.jobId
              ? w.materialListId
                ? `/jobs/material-lists/${w.materialListId}`
                : `/jobs/${w.jobId}/${w.view ?? ""}`
              : page.current;
          })(),
        },
        abort.current.signal,
      );
      if (g !== generation.current) return;
      setTranscript(result.transcript ?? text ?? "");
      setAnswer(result.text ?? "");
      setProposal(result.proposal);
      pendingReview = !!result.proposal;
      if (
        result.href &&
        /^\/jobs(?:\/|$)/.test(result.href) &&
        !result.href.includes("..")
      ) {
        if (result.href === "/jobs") {
          const { resetJobWorkspaceNavigation } =
            await import("~/hooks/use-job-workspace-navigation");
          resetJobWorkspaceNavigation();
        }
        router.push(result.href);
      }
      if (result.speechId) await speak(result.speechId, g);
      if (g === generation.current && live.current !== "paused")
        transition(
          result.proposal ? "review" : mic.current ? "listening" : "paused",
        );
    } catch (e) {
      if (g !== generation.current) return;
      setError(e instanceof Error ? e.message : "Voice request failed.");
      if (live.current !== "paused")
        transition(
          pendingReview ? "review" : mic.current ? "listening" : "paused",
        );
    }
  }
  turnRef.current = (audio) => {
    void turn(undefined, audio);
  };
  async function confirm() {
    if (!proposal || live.current === "thinking") return;
    transition("thinking");
    setError("");
    const g = generation.current;
    try {
      const r = await request({
        action: "confirm",
        sessionId: session.current,
        proposalId: proposal.id,
      });
      if (g !== generation.current) return;
      setProposal(undefined);
      setAnswer(r.text ?? "Saved.");
      router.refresh();
      transition(mic.current ? "listening" : "paused");
    } catch (e) {
      if (g === generation.current) {
        setError(e instanceof Error ? e.message : "Could not apply change.");
        setProposal(undefined);
        transition(mic.current ? "listening" : "paused");
      }
    }
  }
  const active = phase !== "off";
  return (
    <VoiceContext.Provider
      value={{ phase, level, start: () => void start(), stop, error }}
    >
      {children}
      {active && (
        <aside className={styles.dock} aria-label="Voice assistant">
          <div className={styles.dockHeader}>
            <span className={styles.dot} data-active={phase === "listening"} />
            <strong>Foreman Voice</strong>
            <span className={styles.status}>
              {phase === "listening"
                ? "Listening"
                : phase === "thinking"
                  ? "Thinking"
                  : phase === "speaking"
                    ? "Speaking"
                    : phase === "review"
                      ? "Review change"
                      : phase === "paused"
                        ? "Microphone paused"
                        : "Connecting"}
            </span>
            <button aria-label="End voice session" onClick={stop}>
              <XIcon size={20} />
            </button>
          </div>
          {transcript && <p className={styles.heard}>“{transcript}”</p>}
          {answer && (
            <p className={styles.answer} aria-live="polite">
              {answer}
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {proposal && (
            <div className={styles.proposal}>
              <span>CHECK THIS CHANGE</span>
              <p>{proposal.summary}</p>
              <div>
                <button
                  onClick={() => void confirm()}
                  disabled={phase === "thinking"}
                >
                  Apply change
                </button>
                <button
                  onClick={() => {
                    void request({
                      action: "dismiss",
                      sessionId: session.current,
                    });
                    setProposal(undefined);
                    transition(mic.current ? "listening" : "paused");
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          <div className={styles.controls}>
            <button
              aria-label={
                phase === "paused" ? "Resume microphone" : "Pause microphone"
              }
              onClick={() => {
                if (phase === "paused") {
                  void start();
                } else {
                  abort.current?.abort();
                  try {
                    player.current?.stop();
                  } catch {}
                  mic.current?.close();
                  mic.current = null;
                  transition("paused");
                }
              }}
            >
              {phase === "paused" ? (
                <MicOffIcon size={20} />
              ) : (
                <MicIcon size={20} />
              )}
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  draft.trim() &&
                  !["thinking", "speaking", "connecting"].includes(live.current)
                ) {
                  void turn(draft.trim());
                  setDraft("");
                }
              }}
            >
              <input
                aria-label="Message voice assistant"
                placeholder="Or type a request…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={2000}
              />
              <button
                aria-label="Send voice assistant message"
                disabled={
                  phase === "thinking" ||
                  phase === "speaking" ||
                  phase === "connecting" ||
                  !draft.trim()
                }
              >
                <ArrowUpIcon size={18} />
              </button>
            </form>
            {phase === "speaking" && (
              <button
                aria-label="Stop speaking"
                onClick={() => {
                  try {
                    player.current?.stop();
                  } catch {}
                }}
              >
                <Volume2Icon size={20} />
              </button>
            )}
          </div>
          <p className={styles.limits}>No deleting. No sending orders.</p>
        </aside>
      )}
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
    <div>
      <Card
        className={`${styles.card} cursor-pointer transition-shadow hover:shadow-md`}
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
          <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">Voice</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <MicIcon className="h-4 w-4 shrink-0" />
            <span>{description}</span>
          </div>
        </CardContent>
      </Card>
      {voice.error && !active && (
        <p role="alert" className={styles.cardError}>{voice.error}</p>
      )}
    </div>
  );
}
