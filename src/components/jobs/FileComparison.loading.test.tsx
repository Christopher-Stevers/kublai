import { useState, type ComponentType } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileComparisonProps } from "./FileComparison";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const mounted = vi.fn();
function Ready(props: FileComparisonProps) {
  mounted();
  return (
    <section aria-label="Loaded comparison">
      <p>{props.initialDocumentIds?.join("/")}</p>
      <button onClick={props.onClose}>Close loaded comparison</button>
    </section>
  );
}
function Harness({
  Comparison,
  initialOpen = true,
}: {
  Comparison: ComponentType<FileComparisonProps>;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <input aria-label="Receiving draft" defaultValue="" />
      <button onClick={() => setOpen(true)}>Compare</button>
      {open && (
        <Comparison
          inline
          jobId="job"
          initialDocumentIds={["current", "earlier"]}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
beforeEach(() => {
  vi.resetModules();
  mounted.mockClear();
});
afterEach(() => {
  cleanup();
  vi.doUnmock("./FileComparisonContent");
  vi.restoreAllMocks();
});

it("loads only after comparison selection and keeps the parent draft/input through loading", async () => {
  const gate = deferred<{ FileComparison: typeof Ready }>();
  const load = vi.fn(() => gate.promise);
  vi.doMock("./FileComparisonContent", load);
  const { FileComparison } = await import("./FileComparison");
  render(<Harness Comparison={FileComparison} initialOpen={false} />);
  const input = screen.getByLabelText("Receiving draft");
  fireEvent.change(input, { target: { value: "unsaved receiving note" } });
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  expect(screen.getByRole("status")).toHaveTextContent("Loading comparison");
  await act(async () => gate.resolve({ FileComparison: Ready }));
  expect(await screen.findByLabelText("Loaded comparison")).toHaveTextContent(
    "current/earlier",
  );
  expect(screen.getByLabelText("Receiving draft")).toBe(input);
  expect(input).toHaveValue("unsaved receiving note");
});

it("Close works during delayed import and late resolution cannot mount the private viewer", async () => {
  const gate = deferred<{ FileComparison: typeof Ready }>();
  vi.doMock("./FileComparisonContent", () => gate.promise);
  const { FileComparison } = await import("./FileComparison");
  render(<Harness Comparison={FileComparison} />);
  fireEvent.change(screen.getByLabelText("Receiving draft"), {
    target: { value: "keep me" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close comparison" }));
  await act(async () => gate.resolve({ FileComparison: Ready }));
  expect(mounted).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Loaded comparison")).toBeNull();
  expect(screen.getByLabelText("Receiving draft")).toHaveValue("keep me");
});

it("offers local retry and Close after an import failure without discarding parent drafts", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.doMock("./FileComparisonContent", () =>
    Promise.reject(new Error("chunk unavailable")),
  );
  const { FileComparison } = await import("./FileComparison");
  render(<Harness Comparison={FileComparison} />);
  const input = screen.getByLabelText("Receiving draft");
  fireEvent.change(input, {
    target: { value: "retain failed comparison draft" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Comparison could not load",
  );
  expect(screen.queryByRole("button", { name: "Reload app" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Close comparison" }),
  ).toBeEnabled();
  vi.doMock("./FileComparisonContent", () => ({ FileComparison: Ready }));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Loaded comparison")).toBeVisible();
  expect(screen.getByLabelText("Receiving draft")).toBe(input);
  expect(input).toHaveValue("retain failed comparison draft");
});
