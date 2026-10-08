import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("useInstallPrompt", () => {
  it("keeps the browser's install prompt for screens that mount later, then installs", async () => {
    const { useInstallPrompt } = await import("./install-prompt");
    const userChoice = Promise.resolve({ outcome: "accepted" as const, platform: "web" });
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    // Mounted after the event fired, like the chat's bell panel.
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.prompt).toBe(event);
    expect(result.current.installed).toBe(false);

    await act(async () => {
      expect(await result.current.install()).toBe(true);
    });
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(result.current.prompt).toBeNull();
    expect(result.current.installed).toBe(true);
    await act(async () => {
      expect(await result.current.install()).toBe(false);
    });
  });

  it("uses an install offer caught by the page's head script before this code loaded", async () => {
    vi.resetModules();
    const early = Object.assign(new Event("beforeinstallprompt"), {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: "dismissed" as const, platform: "web" }),
    });
    (window as Window & { __foremanhqInstallPrompt?: unknown }).__foremanhqInstallPrompt = early;
    const { useInstallPrompt } = await import("./install-prompt");
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.prompt).toBe(early);
    await act(async () => {
      expect(await result.current.install()).toBe(true);
    });
    expect(early.prompt).toHaveBeenCalledOnce();
    delete (window as Window & { __foremanhqInstallPrompt?: unknown }).__foremanhqInstallPrompt;
  });
});
