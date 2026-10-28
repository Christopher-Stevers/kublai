import { readFile } from "node:fs/promises";
// Never accept a provider URL, key, shell command, or model identifier from a client.
const endpoint = "http://127.0.0.1:8093/foreman/infer";
export async function infer(payload: Record<string, unknown>) {
  const key = (
    await readFile(
      process.env.LFM_VOICE_KEY_FILE ??
        "/home/tim/Projects/lfm3-voice/access-key",
      "utf8",
    )
  ).trim();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-voice-key": key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
    cache: "no-store",
  });
  if (!response.ok)
    throw Error(
      response.status === 429
        ? "The voice server is busy. Try again in a moment."
        : "The voice service could not respond. Please try again.",
    );
  return response;
}
export async function inferText(payload: Record<string, unknown>) {
  const r = await infer(payload);
  return ((await r.json()) as { text: string }).text;
}
export async function voiceHealth() {
  try {
    const r = await fetch("http://127.0.0.1:8093/health", {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    return r.ok && ((await r.json()) as { ready: boolean }).ready;
  } catch {
    return false;
  }
}
