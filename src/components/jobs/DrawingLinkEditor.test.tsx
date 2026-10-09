import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DrawingMarkupLink,
  DrawingWorkspace,
} from "~/lib/drawing-workspace";
import type { DrawingLinkTargets } from "~/lib/drawing-links";
import { DrawingLinkEditor } from "./DrawingLinkEditor";
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  data: { jobs: [], targets: [] } as DrawingLinkTargets,
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: {
      linkTargets: {
        useQuery: (input: unknown, options: unknown) => {
          mock.query(input, options);
          return { data: mock.data, isFetching: false, error: null };
        },
      },
    },
  },
}));
const sheetId = "0391aed4-7773-47ec-9141-09df373ec008";
const fileId = "d814fc88-da7c-4df5-aa89-fe3c1fde0462";
const workspace = {
  sheetId,
  jobId: sheetId,
  jobSheets: [{ id: sheetId, name: "A101" }],
} as DrawingWorkspace;
function Editor({
  initial = [],
  offline = false,
  uploading = vi.fn(),
}: {
  initial?: DrawingMarkupLink[];
  offline?: boolean;
  uploading?: (busy: boolean) => void;
}) {
  const [links, setLinks] = useState(initial);
  return (
    <>
      <DrawingLinkEditor
        links={links}
        onChange={setLinks}
        workspace={workspace}
        offline={offline}
        onUploading={uploading}
      />
      <output data-testid="saved-links">{JSON.stringify(links)}</output>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.data = { jobs: [{ id: sheetId, name: "This job" }], targets: [] };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const saved = () =>
  JSON.parse(
    screen.getByTestId("saved-links").textContent,
  ) as DrawingMarkupLink[];
describe("hyperlink destination editor", () => {
  it("migrates, names, adds, removes, and validates arbitrary destinations", () => {
    render(
      <Editor
        initial={[{ label: "Original drawing", targetSheetId: sheetId }]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Link 1 name"), {
      target: { value: "Equipment layout" },
    });
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(saved()).toHaveLength(1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "mailto:service@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Link name (optional)"), {
      target: { value: "Service contact" },
    });
    fireEvent.keyDown(screen.getByLabelText("Address"), { key: "Enter" });
    expect(saved()).toEqual([
      { label: "Equipment layout", targetSheetId: sheetId },
      { label: "Service contact", url: "mailto:service@example.com" },
    ]);
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "mailto:service@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "already in the hyperlink",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove link 1" }));
    expect(saved()).toEqual([
      { label: "Service contact", url: "mailto:service@example.com" },
    ]);
  });
  it.each(["sheet", "document", "photo", "chat", "materialList", "job"])(
    "adds an accessible %s from the picker",
    (kind) => {
      mock.data.targets = [
        {
          key: "target",
          label: "Selected resource",
          url: "/dashboard/jobs/abc/chat",
        },
      ];
      render(<Editor />);
      fireEvent.change(screen.getByLabelText("Add a destination"), {
        target: { value: kind },
      });
      expect(mock.query).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind, jobId: sheetId }),
        expect.objectContaining({ enabled: true }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Selected resource" }),
      );
      expect(saved()).toEqual([
        { label: "Selected resource", url: "/dashboard/jobs/abc/chat" },
      ]);
    },
  );
  it("browses cached sheets offline and never shows cached resources from an online picker", () => {
    mock.data.targets = [
      {
        key: "hidden",
        label: "Cached photo",
        url: "/dashboard/jobs/abc/documents",
      },
    ];
    render(<Editor offline />);
    fireEvent.change(screen.getByLabelText("Add a destination"), {
      target: { value: "sheet" },
    });
    fireEvent.click(screen.getByRole("button", { name: "A101" }));
    expect(saved()).toEqual([{ label: "A101", targetSheetId: sheetId }]);
    fireEvent.change(screen.getByLabelText("Add a destination"), {
      target: { value: "photo" },
    });
    expect(screen.queryByText("Cached photo")).not.toBeInTheDocument();
    expect(mock.query).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });
  it("uploads a photo as a named hyperlink destination", async () => {
    const url = `/api/drawings/attachments/${sheetId}/${fileId}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ url }), { status: 200 })),
    );
    const uploading = vi.fn();
    render(<Editor uploading={uploading} />);
    fireEvent.change(screen.getByLabelText("Upload a photo or PDF"), {
      target: {
        files: [new File(["image"], "Equipment.png", { type: "image/png" })],
      },
    });
    await waitFor(() =>
      expect(saved()).toEqual([{ label: "Equipment.png", url }]),
    );
    expect(uploading).toHaveBeenCalledWith(true);
    await waitFor(() => expect(uploading).toHaveBeenLastCalledWith(false));
  });
  it("cancels a pending upload when the sheet editor closes", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise(() => undefined);
      }),
    );
    const { unmount } = render(<Editor />);
    fireEvent.change(screen.getByLabelText("Upload a photo or PDF"), {
      target: {
        files: [new File(["image"], "Equipment.png", { type: "image/png" })],
      },
    });
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
