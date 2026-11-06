import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReceivingReplaceSource } from "./ReceivingReplaceSource";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props = () => ({
  jobId: "job",
  documentId: "doc",
  expectedVersionId: "old-version",
  onDone: vi.fn(),
  onCancel: vi.fn(),
});
const pdf = () =>
  new File(["%PDF-1.7\npacking slip"], "complete-slip.pdf", {
    type: "application/pdf",
  });
function choose(file: File) {
  fireEvent.change(screen.getByLabelText("Replacement PDF or image"), {
    target: { files: [file] },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Replace source", exact: true }),
  );
}

it("replaces only the existing document version without starting another reading or receiving", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      success: true,
      documentId: "doc",
      versionId: "new-version",
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const p = props();
  render(<ReceivingReplaceSource {...p} />);
  const file = pdf();
  choose(file);
  await waitFor(() => expect(p.onDone).toHaveBeenCalledTimes(1));
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, request] = fetcher.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/job-documents/upload?jobId=job");
  expect(request.method).toBe("POST");
  const form = request.body as FormData;
  expect(form.get("file")).toBe(file);
  expect(form.get("documentId")).toBe("doc");
  expect(form.get("expectedVersionId")).toBe("old-version");
  expect(form.has("packingSlipOrderId")).toBe(false);
  expect(form.has("action")).toBe(false);
  expect(screen.getByRole("status")).toHaveTextContent("Replacement saved");
  expect(
    screen.queryByRole("button", { name: "Replace source", exact: true }),
  ).not.toBeInTheDocument();
});

it.each([
  [403, "Document editing permission is required."],
  [409, "A newer version exists. Refresh before uploading."],
])(
  "keeps the file and does not continue after HTTP %i",
  async (status, message) => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: message }, { status }),
    );
    vi.stubGlobal("fetch", fetcher);
    const p = props();
    render(<ReceivingReplaceSource {...p} />);
    const file = pdf();
    choose(file);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(p.onDone).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      screen.getByLabelText<HTMLInputElement>("Replacement PDF or image")
        .files?.[0],
    ).toBe(file);
  },
);

it("rejects an unsupported file even when named as a PDF", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(<ReceivingReplaceSource {...props()} />);
  choose(new File(["not a PDF"], "scan.pdf", { type: "application/pdf" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose a PDF, JPEG, PNG, WebP or GIF",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([0, 50 * 1024 * 1024 + 1])(
  "rejects invalid file size %i before uploading",
  async (size) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<ReceivingReplaceSource {...props()} />);
    const file = pdf();
    Object.defineProperty(file, "size", { value: size });
    choose(file);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nonempty file no larger than 50 MB",
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("allows a supported image with no browser MIME type", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      success: true,
      documentId: "doc",
      versionId: "new-version",
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const p = props();
  render(<ReceivingReplaceSource {...p} />);
  choose(new File([new Uint8Array([255, 216, 255, 224, 0])], "scan.jpg"));
  await waitFor(() => expect(p.onDone).toHaveBeenCalledTimes(1));
});

it("does not allow replacing a source while disabled or without a version guard", () => {
  const p = props();
  const view = render(<ReceivingReplaceSource {...p} disabled />);
  expect(screen.getByLabelText("Replacement PDF or image")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Replace source", exact: true }),
  ).toBeDisabled();
  view.rerender(<ReceivingReplaceSource {...p} expectedVersionId="" />);
  expect(screen.getByLabelText("Replacement PDF or image")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(p.onCancel).toHaveBeenCalledTimes(1);
});

it("does not re-upload if refreshing after a confirmed save fails", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      success: true,
      documentId: "doc",
      versionId: "new-version",
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const p = {
    ...props(),
    onDone: vi.fn(async () => {
      throw new Error("Offline");
    }),
  };
  render(<ReceivingReplaceSource {...p} />);
  choose(pdf());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "replacement was saved",
  );
  expect(
    screen.queryByRole("button", { name: "Replace source", exact: true }),
  ).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
