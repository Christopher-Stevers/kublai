import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevSettings } from "~/components/account/DevSettings";
import { DevFeaturesProvider } from "~/components/app/DevFeaturesProvider";
import { DevVoiceProvider, VoiceProvider, VoiceCard } from "./VoiceProvider";
const m = vi.hoisted(() => ({
  close: vi.fn(),
  mic: vi.fn(),
  fetch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./audio", () => ({ microphone: m.mic, pcm16: () => "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push, refresh: m.refresh }),
  usePathname: () => "/jobs",
}));
const calls: Record<string, unknown>[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  m.mic.mockResolvedValue({ close: m.close, context: {} });
  m.fetch.mockImplementation(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push(body);
    if (body.action === "start") return Response.json({ sessionId: "session" });
    if (body.action === "turn")
      return Response.json({
        transcript: body.text,
        text: "Check this change.",
        proposal: { id: "proposal", summary: "Create job Test" },
      });
    return Response.json({ text: "Saved.", saved: true });
  });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
async function start() {
  render(
    <VoiceProvider>
      <VoiceCard />
    </VoiceProvider>,
  );
  expect(m.mic).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start voice assistant" }).getAttribute("data-lit")).toBe("false");
  fireEvent.click(
    screen.getByRole("button", { name: "Start voice assistant" }),
  );
  await screen.findByText("Listening");
  expect(screen.getAllByRole("button", { name: "End voice session" })[0]!.getAttribute("data-lit")).toBe("true");
}
it("starts only on a tap and releases the microphone on end", async () => {
  await start();
  expect(m.mic).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getAllByRole("button", { name: "End voice session" })[0]!,
  );
  expect(m.close).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Voice assistant")).toBeNull();
});
it("requires a separate screen tap to apply a proposal", async () => {
  await start();
  fireEvent.change(screen.getByLabelText("Message voice assistant"), {
    target: { value: "Create job Test" },
  });
  fireEvent.click(screen.getByLabelText("Send voice assistant message"));
  await screen.findByText("Create job Test");
  expect(screen.getAllByRole("button", { name: "End voice session" })[0]!.getAttribute("data-lit")).toBe("false");
  expect(calls.some((c) => c.action === "confirm")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Apply change" }));
  await screen.findByText("Saved.");
  expect(calls.filter((c) => c.action === "confirm")).toEqual([
    { action: "confirm", sessionId: "session", proposalId: "proposal" },
  ]);
});
it("pauses and closes the microphone when the tab is hidden", async () => {
  await start();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  await screen.findByText("Microphone paused");
  expect(m.close).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});
it("unmounting releases the microphone", async () => {
  await start();
  cleanup();
  expect(m.close).toHaveBeenCalledOnce();
});

it("turning Dev off releases an active microphone and removes Voice", async () => {
  render(<DevFeaturesProvider enabled><DevSettings /><DevVoiceProvider><VoiceCard /></DevVoiceProvider></DevFeaturesProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Start voice assistant" }));
  await screen.findByText("Listening");
  fireEvent.click(screen.getByRole("switch", { name: "Show Dev features" }));
  expect(m.close).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("Voice assistant")).toBeNull();
  expect(screen.queryByRole("button", { name: "Start voice assistant" })).toBeNull();
});
