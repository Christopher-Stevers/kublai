import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  save: vi.fn(),
  read: vi.fn(),
  invalidate: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      drawingsWorkspace: {
        list: { invalidate: state.invalidate },
        get: { fetch: state.workspace },
      },
    }),
    drawingsWorkspace: {
      metadata: { useMutation: () => ({ mutateAsync: state.save }) },
    },
  },
}));
vi.mock("~/lib/pdf-client", () => ({
  sourcePdfPage: (url: string) => ({ url, page: 1 }),
}));
vi.mock("~/lib/drawing-text", async (importOriginal) => ({
  ...(await importOriginal<typeof DrawingTextModule>()),
  readDrawingText: state.read,
}));
import type * as DrawingTextModule from "~/lib/drawing-text";
import { DrawingSheetRegister } from "./DrawingSheetRegister";
beforeEach(() => {
  state.workspace.mockReset().mockResolvedValue({
    metadata: {
      number: "",
      title: "",
      discipline: "",
      tags: [],
      status: "draft",
      scale: null,
      revision: 0,
      currentSourceSheetId: "current",
    },
    jobSheets: [{ id: "current", imageUrl: "/current-drawing" }],
  });
  state.save.mockReset().mockResolvedValue({});
  state.read.mockReset().mockResolvedValue({
    words: [
      { text: "A201", left: 0.8, top: 0.8, right: 0.9, bottom: 0.85 },
      { text: "FLOOR PLAN", left: 0.7, top: 0.9, right: 0.95, bottom: 0.95 },
    ],
    links: [],
  });
});
afterEach(async () => {
  cleanup();
  // Radix restores focus on the next task; finish before jsdom is disposed.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});
it("reviews extracted title blocks before saving shared metadata", async () => {
  render(
    <DrawingSheetRegister
      jobId="job"
      sheets={[{ id: "sheet", name: "Page 1", imageUrl: "/drawing" }]}
      summaries={[]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read title blocks" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Read 1 sheets" })),
  );
  expect(screen.getByLabelText("Page 1 number")).toHaveValue("A201");
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Page 1 title"), {
    target: { value: "Corrected level plan" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save selected sheet details" }),
  );
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.save.mock.calls[0]?.[0]).toMatchObject({
    sheetId: "sheet",
    expectedRevision: 0,
    data: {
      number: "A201",
      title: "Corrected level plan",
      discipline: "Architectural",
    },
  });
});
it("keeps a conflicting row selected and shows the server error", async () => {
  state.save.mockRejectedValueOnce(
    Error("Another person changed this drawing. Reload."),
  );
  render(
    <DrawingSheetRegister
      jobId="job"
      sheets={[{ id: "sheet", name: "Page 1", imageUrl: "/drawing" }]}
      summaries={[]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read title blocks" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Read 1 sheets" })),
  );
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Save selected sheet details" }),
    ),
  );
  expect(
    screen.getByText("Another person changed this drawing. Reload."),
  ).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeChecked();
});

it("reads the current revision and retains its reviewed metadata revision across refetches", async () => {
  const sheets = [{ id: "sheet", name: "Page 1", imageUrl: "/old-drawing" }];
  const view = render(
    <DrawingSheetRegister jobId="job" sheets={sheets} summaries={[]} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read title blocks" }));
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Read 1 sheets" })),
  );
  expect(state.read).toHaveBeenCalledWith({ url: "/current-drawing", page: 1 });
  view.rerender(
    <DrawingSheetRegister
      jobId="job"
      sheets={sheets}
      summaries={[
        {
          sheetId: "sheet",
          favorite: false,
          watching: false,
          issueCount: 0,
          markupCount: 0,
          metadata: {
            number: "A201",
            title: "Someone else's new title",
            discipline: "",
            tags: [],
            status: "draft",
            scale: null,
            revision: 99,
            currentSourceSheetId: "newer",
          },
        },
      ]}
    />,
  );
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Save selected sheet details" }),
    ),
  );
  expect(state.save.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 0 });
});
