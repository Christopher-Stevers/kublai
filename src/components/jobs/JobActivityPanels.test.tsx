import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInstantMutation } from "~/hooks/use-instant-mutation";
import { useEffect, useState } from "react";
import { JobActivityPanels } from "./JobActivityPanels";
import { isAppPageActive, setAppPageActive } from "~/lib/app-page-activity";
let instance = 0;
const connected = new Set<string>();
function Panel({ name }: { name: string }) {
  const [id] = useState(() => ++instance),
    [draft, setDraft] = useState("");
  useEffect(() => {
    connected.add(name);
    return () => {
      connected.delete(name);
    };
  }, [name]);
  return (
    <div data-instance={id}>
      <label>
        {name}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
    </div>
  );
}
const view = (name: string, job = "job-a") => (
  <JobActivityPanels key={job} activeKey={name}>
    <Panel name={name} />
  </JobActivityPanels>
);
beforeEach(() => {
  instance = 0;
  connected.clear();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  setAppPageActive(true);
});
afterEach(() => {
  cleanup();
  setAppPageActive(true);
});
describe("bounded visited job activity panels", () => {
  it("preserves a visited draft while disconnecting hidden panel effects", () => {
    const ui = render(view("lists"));
    const first = screen
      .getByLabelText("lists")
      .closest("[data-instance]")!
      .getAttribute("data-instance");
    fireEvent.change(screen.getByLabelText("lists"), {
      target: { value: "unsent draft" },
    });
    ui.rerender(view("chat"));
    expect([...connected]).toEqual(["chat"]);
    expect(
      screen.queryByRole("textbox", { name: "lists" }),
    ).not.toBeInTheDocument();
    ui.rerender(view("lists"));
    expect(screen.getByLabelText("lists")).toHaveValue("unsent draft");
    expect(
      screen.getByLabelText("lists").closest("[data-instance]"),
    ).toHaveAttribute("data-instance", first);
    expect([...connected]).toEqual(["lists"]);
  });
  it("keeps at most two hidden panels and evicts the least recently active one", () => {
    const ui = render(view("one"));
    const original = screen
      .getByLabelText("one")
      .closest("[data-instance]")!
      .getAttribute("data-instance");
    for (const name of ["two", "three", "four"]) {
      ui.rerender(view(name));
      expect(
        ui.container.querySelectorAll("[data-job-panel]").length,
      ).toBeLessThanOrEqual(3);
    }
    expect(ui.container.querySelector('[data-job-panel="one"]')).toBeNull();
    ui.rerender(view("one"));
    expect(
      screen
        .getByLabelText("one")
        .closest("[data-instance]")!
        .getAttribute("data-instance"),
    ).not.toBe(original);
  });
  it("drops inactive panels and pauses the active panel when the app window is hidden", () => {
    const ui = render(view("lists"));
    ui.rerender(view("chat"));
    fireEvent.change(screen.getByLabelText("chat"), {
      target: { value: "draft" },
    });
    const current = screen
      .getByLabelText("chat")
      .closest("[data-instance]")!
      .getAttribute("data-instance");
    act(() => setAppPageActive(false));
    expect(ui.container.querySelectorAll("[data-job-panel]")).toHaveLength(1);
    expect([...connected]).toEqual([]);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(isAppPageActive()).toBe(false);
    act(() => setAppPageActive(true));
    expect(screen.getByLabelText("chat")).toHaveValue("draft");
    expect(
      screen.getByLabelText("chat").closest("[data-instance]"),
    ).toHaveAttribute("data-instance", current);
    expect([...connected]).toEqual(["chat"]);
  });
  it("never overrides the outer internal-window pause, including on unmount", () => {
    const ui = render(view("lists"));
    act(() => setAppPageActive(false));
    ui.unmount();
    expect(isAppPageActive()).toBe(false);
  });
  it("creates no unopened panel and resets retained state when the job/account owner changes key", () => {
    const ui = render(view("lists"));
    expect(instance).toBe(1);
    fireEvent.change(screen.getByLabelText("lists"), {
      target: { value: "private job draft" },
    });
    ui.rerender(view("lists", "job-b"));
    expect(screen.getByLabelText("lists")).toHaveValue("");
    expect(ui.container.querySelectorAll("[data-job-panel]")).toHaveLength(1);
  });
  it("does not cancel an already-started authorized mutation while its reviewed panel pauses", async () => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const send = vi.fn(() => pending),
      client = new QueryClient();
    function Writing() {
      const mutation = useInstantMutation({
        mutationKey: ["activity-write"],
        mutationFn: send,
        optimistic: () => ({
          rollback: vi.fn(),
          commit: (value: string) => client.setQueryData(["saved"], value),
        }),
        errorMessage: "Save failed",
      });
      return <button onClick={() => mutation.mutate(undefined)}>Save</button>;
    }
    render(
      <QueryClientProvider client={client}>
        <JobActivityPanels activeKey="write">
          <Writing />
        </JobActivityPanels>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    act(() => setAppPageActive(false));
    await act(async () => {
      finish("committed");
      await pending;
    });
    await waitFor(() =>
      expect(client.getQueryData(["saved"])).toBe("committed"),
    );
    expect(send).toHaveBeenCalledOnce();
    client.clear();
  });
});
