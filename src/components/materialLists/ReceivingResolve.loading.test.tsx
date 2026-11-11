import {
  Component,
  type ReactNode,
  useState,
  type ComponentType,
  type ComponentProps,
} from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReceivingResolve } from "./ReceivingResolve";
type Props = ComponentProps<typeof ReceivingResolve>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const run = vi.fn(async () => true),
  mounted = vi.fn();
function Editor(props: Props) {
  const [note, setNote] = useState("");
  mounted();
  return (
    <>
      <input
        aria-label="Resolution note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <p>{props.jobId}</p>
      <button
        onClick={() => void props.run({ action: "note", lineId: "line", note })}
      >
        Save note
      </button>
    </>
  );
}
function Harness({
  Panel,
  selected = true,
}: {
  Panel: ComponentType<Props>;
  selected?: boolean;
}) {
  const [open, setOpen] = useState(selected);
  return (
    <>
      <input aria-label="Parent receiving draft" defaultValue="" />
      <button onClick={() => setOpen(true)}>Resolve</button>
      {open && (
        <Panel
          detail={{} as Props["detail"]}
          jobId="job"
          target={{ lineId: "line" }}
          busy={false}
          run={run}
          onClose={() => setOpen(false)}
          onSelect={vi.fn()}
          onReload={async () => undefined}
          onAddLine={async () => true}
          renderCorrection={() => null}
        />
      )}
    </>
  );
}
beforeEach(() => {
  vi.resetModules();
  run.mockClear();
  mounted.mockClear();
});
afterEach(() => {
  cleanup();
  vi.doUnmock("./ReceivingResolveContent");
  vi.restoreAllMocks();
});
it("does not import before selection and keeps parent state through delayed opening", async () => {
  const gate = deferred<{ ReceivingResolve: typeof Editor }>();
  const load = vi.fn(() => gate.promise);
  vi.doMock("./ReceivingResolveContent", load);
  const { ReceivingResolve } = await import("./ReceivingResolve");
  render(<Harness Panel={ReceivingResolve} selected={false} />);
  const parent = screen.getByLabelText("Parent receiving draft");
  fireEvent.change(parent, { target: { value: "not saved" } });
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  expect(screen.getByRole("status")).toHaveTextContent("Opening resolution");
  expect(run).not.toHaveBeenCalled();
  await act(async () => gate.resolve({ ReceivingResolve: Editor }));
  await screen.findByLabelText("Resolution note");
  expect(screen.getByLabelText("Parent receiving draft")).toBe(parent);
  expect(parent).toHaveValue("not saved");
});
it("Back before load cancels the late editor without reads or writes", async () => {
  const gate = deferred<{ ReceivingResolve: typeof Editor }>();
  vi.doMock("./ReceivingResolveContent", () => gate.promise);
  const { ReceivingResolve } = await import("./ReceivingResolve");
  render(<Harness Panel={ReceivingResolve} />);
  fireEvent.click(screen.getByRole("button", { name: "Back to receiving" }));
  await act(async () => gate.resolve({ ReceivingResolve: Editor }));
  expect(mounted).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Resolution note")).toBeNull();
});
it("retries only rejected imports and retains a mounted editor draft on ordinary rerenders", async () => {
  vi.doMock("./ReceivingResolveContent", () =>
    Promise.reject(Error("chunk missing")),
  );
  const { ReceivingResolve } = await import("./ReceivingResolve");
  const view = render(<Harness Panel={ReceivingResolve} />);
  const parent = screen.getByLabelText("Parent receiving draft");
  fireEvent.change(parent, { target: { value: "receiving note" } });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Resolution could not load",
  );
  expect(screen.queryByText("Reload app")).toBeNull();
  vi.doMock("./ReceivingResolveContent", () => ({ ReceivingResolve: Editor }));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  const note = await screen.findByLabelText("Resolution note");
  fireEvent.change(note, { target: { value: "unsaved resolution note" } });
  view.rerender(<Harness Panel={ReceivingResolve} />);
  expect(screen.getByLabelText("Resolution note")).toBe(note);
  expect(note).toHaveValue("unsaved resolution note");
  expect(parent).toHaveValue("receiving note");
  expect(screen.queryByText("Try again")).toBeNull();
});

it("does not turn mounted editor render errors into import retries", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  function BrokenEditor() {
    const [broken, setBroken] = useState(false);
    if (broken) throw Error("editor render failed");
    return <button onClick={() => setBroken(true)}>Break editor</button>;
  }
  class ExistingBoundary extends Component<
    { children: ReactNode },
    { failed: boolean }
  > {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    render() {
      return this.state.failed ? (
        <p>Existing application error boundary</p>
      ) : (
        this.props.children
      );
    }
  }
  vi.doMock("./ReceivingResolveContent", () => ({
    ReceivingResolve: BrokenEditor,
  }));
  const { ReceivingResolve } = await import("./ReceivingResolve");
  render(
    <ExistingBoundary>
      <Harness Panel={ReceivingResolve} />
    </ExistingBoundary>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Break editor" }));
  expect(
    await screen.findByText("Existing application error boundary"),
  ).toBeVisible();
  expect(screen.queryByText("Try again")).toBeNull();
  expect(screen.queryByText(/Resolution could not load/)).toBeNull();
});
