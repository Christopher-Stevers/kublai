import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ load: vi.fn(), warm: vi.fn(() => () => undefined) }));
vi.mock("~/lib/background-work", () => ({ scheduleBackgroundWork: calls.warm }));
vi.mock("~/components/materialLists/AddPartDialog", () => {
  calls.load();
  return { AddPartDialog: () => <div>Choose a part</div> };
});
import { AddPartDialog, warmDeferredFeatures } from "./DeferredFeatures";
afterEach(cleanup);
it("downloads no unopened features and loads a chosen dialog immediately", async () => {
  const props = { open: false, onOpenChange: vi.fn(), materialListId: "list" };
  const view = render(<AddPartDialog {...props} />);
  act(() => warmDeferredFeatures());
  expect(calls.load).not.toHaveBeenCalled();
  expect(calls.warm).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new Event("online")));
  expect(calls.warm).not.toHaveBeenCalled();
  view.rerender(<AddPartDialog {...props} open />);
  expect(await screen.findByText("Choose a part")).toBeInTheDocument();
  expect(calls.load).toHaveBeenCalledOnce();
});
