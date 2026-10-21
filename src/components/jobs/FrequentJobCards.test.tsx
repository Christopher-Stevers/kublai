import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { JobWorkspaceOptions } from "./JobWorkspaceOptions";
import {
  rankJobCards,
  recordJobCard,
  emptyJobCardPreferences,
} from "~/lib/job-card-frequency";
let accountKey = "org:alice";
vi.mock("./DrawingAccountProvider", () => ({
  useDrawingAccount: () => ({ accountKey }),
}));
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    clear: () => values.clear(),
  });
  accountKey = "org:alice";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const firstCard = () => screen.getAllByRole("button")[0];
it("records a choice without moving cards until the next visit, and restores fixed order", () => {
  const select = vi.fn();
  const view = render(<JobWorkspaceOptions onSelect={select} />);
  fireEvent.click(screen.getByRole("button", { name: "Chat" }));
  expect(firstCard()).toHaveTextContent("Material Lists");
  expect(select).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<JobWorkspaceOptions onSelect={select} />);
  expect(firstCard()).toHaveTextContent("Chat");
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Frequently used first" }),
  );
  expect(firstCard()).toHaveTextContent("Material Lists");
});
it("keeps accounts separate and counts keyboard navigation", () => {
  const view = render(<JobWorkspaceOptions onSelect={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Chat" }), {
    key: "Enter",
  });
  view.unmount();
  accountKey = "org:bob";
  const other = render(<JobWorkspaceOptions onSelect={vi.fn()} />);
  expect(firstCard()).toHaveTextContent("Material Lists");
  other.unmount();
  accountKey = "org:alice";
  render(<JobWorkspaceOptions onSelect={vi.fn()} />);
  expect(firstCard()).toHaveTextContent("Chat");
});
it("lets recent choices outrank older habits with stable default ties", () => {
  let prefs = emptyJobCardPreferences();
  for (let i = 0; i < 4; i++) prefs = recordJobCard(prefs, "rooms", 0);
  const now = 120 * 86400000;
  prefs = recordJobCard(prefs, "chat", now);
  expect(rankJobCards(prefs, now).slice(0, 3)).toEqual([
    "chat",
    "rooms",
    "material-lists",
  ]);
});
