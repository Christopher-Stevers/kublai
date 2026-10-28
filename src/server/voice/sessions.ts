import { randomBytes } from "node:crypto";
import type { VoiceMutation } from "./policy";
import { newEvidence, type Evidence } from "./clarification";
type Pending = {
  id: string;
  change: VoiceMutation;
  summary: string;
  fingerprint: string;
  expires: number;
};
export type VoiceSession = {
  userId: string;
  org: string;
  expires: number;
  busy: boolean;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  pending?: Pending;
  speech?: { text: string; id: string };
  requests: number;
  evidence: Evidence;
};
const sessions = new Map<string, VoiceSession>();
export function startSession(userId: string, org: string) {
  for (const [id, s] of sessions)
    if (s.expires < Date.now() || s.userId === userId) sessions.delete(id);
  if (sessions.size >= 100)
    throw Error("Voice is at capacity. Please try again later.");
  const id = randomBytes(24).toString("hex");
  sessions.set(id, {
    userId,
    org,
    expires: Date.now() + 30 * 60000,
    busy: false,
    history: [],
    requests: 0,
    evidence: newEvidence(),
  });
  return id;
}
export function getSession(id: string, userId: string, org: string) {
  const s = sessions.get(id);
  if (s?.userId !== userId || s.org !== org || s.expires < Date.now())
    throw Error("Voice session ended. Tap Voice to reconnect.");
  return s;
}
export function endSession(id: string, userId: string, org: string) {
  getSession(id, userId, org);
  sessions.delete(id);
}
export function propose(
  s: VoiceSession,
  change: VoiceMutation,
  summary: string,
  fingerprint: string,
) {
  s.pending = {
    id: randomBytes(24).toString("hex"),
    change,
    summary,
    fingerprint,
    expires: Date.now() + 2 * 60000,
  };
  return { id: s.pending.id, summary };
}
export function takePending(s: VoiceSession, id: string) {
  const p = s.pending;
  if (p?.id !== id || p.expires < Date.now())
    throw Error("This preview expired. Please ask again.");
  delete s.pending;
  return p;
}
