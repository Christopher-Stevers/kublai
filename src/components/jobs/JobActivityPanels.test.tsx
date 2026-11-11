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
import {
  Profiler,
  StrictMode,
  Suspense,
  startTransition,
  useEffect,
  useState,
} from "react";
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

it("commits a fresh active child prop exactly once without post-commit bookkeeping", () => {
  const phases: string[] = [];
  const measured = (revision: number) => (
    <Profiler id="panels" onRender={(_id, phase) => phases.push(phase)}>
      <JobActivityPanels activeKey="lists">
        <Panel name={`lists-${revision}`} />
      </JobActivityPanels>
    </Profiler>
  );
  const ui = render(measured(0));
  phases.length = 0;
  ui.rerender(measured(1));
  expect(screen.getByLabelText("lists-1")).toBeVisible();
  expect(phases).toEqual(["update"]);
});

it("keeps the same active DOM/draft across fresh child nodes in Strict Mode", () => {
  const measured = () => <StrictMode>{view("lists")}</StrictMode>;
  const ui = render(measured());
  const input = screen.getByLabelText("lists");
  fireEvent.change(input, { target: { value: "still editing" } });
  ui.rerender(measured());
  expect(screen.getByLabelText("lists")).toBe(input);
  expect(input).toHaveValue("still editing");
  expect([...connected]).toEqual(["lists"]);
});

it("does not retain a panel from an abandoned suspended transition", () => {
  const blocked = new Promise<void>(() => undefined);
  function Content({ name }: { name: string }) {
    if (name === "blocked") {
      // React Suspense explicitly uses a pending thenable, rather than an Error.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw blocked;
    }
    return <Panel name={name} />;
  }
  function Owner() {
    const [name, setName] = useState("lists");
    return (
      <>
        <button onClick={() => startTransition(() => setName("blocked"))}>
          Start suspended
        </button>
        <button onClick={() => setName("chat")}>Override transition</button>
        <button onClick={() => setName("lists")}>Return to lists</button>
        <Suspense fallback={<span>Pending panel</span>}>
          <JobActivityPanels activeKey={name}>
            <Content name={name} />
          </JobActivityPanels>
        </Suspense>
      </>
    );
  }
  const ui = render(<Owner />);
  const input = screen.getByLabelText("lists");
  fireEvent.change(input, { target: { value: "committed draft" } });
  fireEvent.click(screen.getByText("Start suspended"));
  expect(screen.getByLabelText("lists")).toBe(input);
  fireEvent.click(screen.getByText("Override transition"));
  expect(screen.getByLabelText("chat")).toBeVisible();
  expect(ui.container.querySelector('[data-job-panel="blocked"]')).toBeNull();
  fireEvent.click(screen.getByText("Return to lists"));
  expect(screen.getByLabelText("lists")).toBe(input);
  expect(input).toHaveValue("committed draft");
});
