import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentOverview, JobDocument } from "~/server/documents/types";

vi.mock("~/components/ui/app-dialogs", () => ({
  confirmAction: vi.fn(async () => true),
  notify: vi.fn(),
}));
import { JobDocumentsView } from "./JobDocumentsView";

let overview: DocumentOverview;
let requests: Array<{ url: string; init?: RequestInit }>;
const when = "2026-10-07T12:00:00.000Z";
function doc(overrides: Partial<JobDocument> = {}): JobDocument {
  return {
    id: "doc-1",
    jobId: "job-1",
    folderId: null,
    name: "Specification.pdf",
    description: "Mechanical scope",
    tags: ["scope"],
    status: "draft",
    currentVersionId: "version-2",
    officeWebUrl: null,
    lockedBy: null,
    deletedAt: null,
    createdBy: "user-1",
    createdAt: when,
    updatedAt: when,
    canWrite: true,
    canManage: true,
    ...overrides,
  };
}
const posts = () => requests.filter((item) => item.init?.method === "POST");
const jsonPosts = () =>
  posts()
    .filter((item) => typeof item.init?.body === "string")
    .map(
      (item) =>
        JSON.parse(item.init!.body as string) as Record<string, unknown>,
    );
async function ready() {
  await screen.findByRole("button", { name: "Open Specification.pdf" });
}

beforeEach(() => {
  requests = [];
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  overview = {
    schemaVersion: 1,
    capabilities: { canWrite: true, canManage: true, userId: "user-1" },
    office: { mode: "linked", embeddedConfigured: false },
    members: [
      { id: "user-1", name: "Tim", email: "tim@example.com" },
      { id: "user-2", name: "Alex", email: "alex@example.com" },
    ],
    folders: [
      {
        id: "folder-1",
        parentId: null,
        name: "Contracts",
        permissions: [],
        createdBy: "user-1",
        createdAt: when,
        updatedAt: when,
        canWrite: true,
        canManage: true,
      },
    ],
    documents: [
      doc(),
      doc({
        id: "doc-2",
        folderId: "folder-1",
        name: "Agreement.docx",
        description: "Legal agreement",
        currentVersionId: "version-3",
        tags: ["legal"],
      }),
    ],
    versions: [
      {
        id: "version-1",
        documentId: "doc-1",
        number: 1,
        name: "Specification.pdf",
        size: 100,
        mimeType: "application/pdf",
        sha256: "old",
        createdBy: "user-1",
        createdAt: when,
        restoredFromVersionId: null,
      },
      {
        id: "version-2",
        documentId: "doc-1",
        number: 2,
        name: "Specification.pdf",
        size: 200,
        mimeType: "application/pdf",
        sha256: "new",
        createdBy: "user-1",
        createdAt: when,
        restoredFromVersionId: null,
      },
      {
        id: "version-3",
        documentId: "doc-2",
        number: 1,
        name: "Agreement.docx",
        size: 120,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sha256: "word",
        createdBy: "user-1",
        createdAt: when,
        restoredFromVersionId: null,
      },
    ],
    comments: [],
    activity: [],
    reviews: [],
    transmittals: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (init?.method === "POST")
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response(JSON.stringify(overview), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("job documents workspace", () => {
  it("navigates folders and searches names, descriptions, and tags across the job", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    expect(
      screen.queryByRole("button", { name: "Open Agreement.docx" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Contracts" }));
    expect(
      screen.getByRole("button", { name: "Open Agreement.docx" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search documents"), {
      target: { value: "mechanical" },
    });
    expect(
      screen.getByRole("button", { name: "Open Specification.pdf" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Agreement.docx" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by file type"), {
      target: { value: "word" },
    });
    expect(screen.getByText("No matching documents")).toBeInTheDocument();
  });

  it("creates a folder and uploads a file into the open folder", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Contracts" }));
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: " Submittals " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        action: "createFolder",
        name: "Submittals",
        parentId: "folder-1",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const file = new File(["sample"], "schedule.csv", { type: "text/csv" });
    await act(async () =>
      fireEvent.change(screen.getByLabelText("Upload document files"), {
        target: { files: [file] },
      }),
    );
    const upload = posts().find((item) => item.url.includes("/upload"))!;
    expect((upload.init!.body as FormData).get("folderId")).toBe("folder-1");
    expect((upload.init!.body as FormData).get("file")).toBe(file);
  });

  it("uploads a new revision with the expected current version and supports saved revision comparison", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Specification.pdf" }),
    );
    expect(
      screen.getByTitle("Preview Specification.pdf version 2"),
    ).toHaveAttribute("src", "/api/job-documents/files/version-2?jobId=job-1");
    fireEvent.click(screen.getByRole("button", { name: "Upload new version" }));
    await act(async () =>
      fireEvent.change(screen.getByLabelText("Upload document files"), {
        target: {
          files: [
            new File(["%PDF"], "revision.pdf", { type: "application/pdf" }),
          ],
        },
      }),
    );
    const form = posts().find((item) => item.url.includes("/upload"))!.init!
      .body as FormData;
    expect(form.get("documentId")).toBe("doc-1");
    expect(form.get("expectedVersionId")).toBe("version-2");
    fireEvent.click(screen.getByRole("tab", { name: "versions" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare v1" }));
    expect(screen.getByText("Compare saved revisions")).toBeInTheDocument();
    expect(screen.getByTitle("PDF version 1")).toHaveAttribute(
      "src",
      "/api/job-documents/files/version-1?jobId=job-1",
    );
  });

  it("lets readers comment but hides document management", async () => {
    overview.capabilities.canManage = false;
    overview.capabilities.canWrite = false;
    overview.folders[0]!.canManage = false;
    overview.folders[0]!.canWrite = false;
    overview.documents.forEach((item) => {
      item.canWrite = false;
      item.canManage = false;
    });
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    expect(
      screen.queryByRole("button", { name: "Upload files" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Specification.pdf" }),
    );
    expect(
      screen.queryByRole("button", { name: "Edit details" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "comments" }));
    fireEvent.change(screen.getByLabelText("Add a comment"), {
      target: { value: " Please confirm this revision. " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        action: "comment",
        documentId: "doc-1",
        body: "Please confirm this revision.",
      }),
    );
  });

  it("uses real Microsoft file links and does not offer an immutable review of live links", async () => {
    overview.documents.push(
      doc({
        id: "linked",
        name: "Budget.xlsx",
        currentVersionId: null,
        officeWebUrl:
          "https://company.sharepoint.com/Shared%20Documents/Budget.xlsx",
      }),
    );
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Open Budget.xlsx" }));
    expect(screen.getByRole("link", { name: "Open in Excel" })).toHaveAttribute(
      "href",
      overview.documents[2]!.officeWebUrl,
    );
    expect(
      screen.getByText(/Live editing, sharing permissions/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Upload new version" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create transmittal" }),
    ).not.toBeInTheDocument();
  });

  it("records transmittal recipient emails and selected document IDs", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(screen.getByLabelText("Select Specification.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Create transmittal" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Issued for construction" },
    });
    fireEvent.click(screen.getByLabelText("Alex"));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Create transmittal" }).at(-1)!,
    );
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        action: "createTransmittal",
        title: "Issued for construction",
        documentIds: ["doc-1"],
        recipients: ["alex@example.com"],
        message: "",
      }),
    );
  });

  it("edits approved metadata without bypassing the review workflow", async () => {
    overview.documents[0]!.status = "approved";
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Specification.pdf" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Approved scope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(jsonPosts()[0]).toEqual({
        jobId: "job-1",
        action: "updateDocument",
        documentId: "doc-1",
        name: "Specification.pdf",
        description: "Approved scope",
        tags: ["scope"],
      }),
    );
  });

  it("never sends requests in the tutorial sandbox and blocks writes offline", async () => {
    const first = render(<JobDocumentsView jobId="job-1" sandbox />);
    expect(screen.getByText(/read-only in the tutorial/)).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    first.unmount();
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    act(() => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value: false,
      });
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText(/You are offline/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Upload files" }),
    ).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("keeps a failed mutation open with its server error and does not imply success", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? new Response(
            JSON.stringify({ error: "This folder is no longer writable." }),
            { status: 403 },
          )
        : new Response(JSON.stringify(overview)),
    );
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Private" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This folder is no longer writable.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("creates a review assigned to a real project member", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(screen.getByLabelText("Select Specification.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Request review" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Scope review" },
    });
    fireEvent.change(screen.getByLabelText("Assigned reviewer"), {
      target: { value: "user-2" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Request review" }).at(-1)!,
    );
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        action: "createReview",
        title: "Scope review",
        documentIds: ["doc-1"],
        reviewerId: "user-2",
      }),
    );
  });

  it("saves an explicit folder access list", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Contracts" }));
    fireEvent.click(screen.getByRole("button", { name: "Permissions" }));
    fireEvent.change(screen.getByLabelText("Access for Alex"), {
      target: { value: "viewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        action: "setFolderPermissions",
        folderId: "folder-1",
        permissions: [{ userId: "user-2", role: "viewer" }],
      }),
    );
  });

  it("does not reuse a cancelled revision target for a dropped file", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Specification.pdf" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Upload new version" }));
    fireEvent(
      screen.getByLabelText("Upload document files"),
      new Event("cancel"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await act(async () =>
      fireEvent.drop(screen.getByLabelText("Document file list"), {
        dataTransfer: {
          files: [new File(["new"], "new.txt", { type: "text/plain" })],
        },
      }),
    );
    const form = posts().find((item) => item.url.includes("/upload"))!.init!
      .body as FormData;
    expect(form.get("documentId")).toBeNull();
    expect(form.get("expectedVersionId")).toBeNull();
  });

  it("downloads the persisted transmittal snapshot without issuing a new transmission", async () => {
    overview.transmittals = [
      {
        id: "transmittal-1",
        title: "Issue 01",
        documents: [
          {
            documentId: "doc-1",
            versionId: "version-1",
            name: "Original specification.pdf",
            officeWebUrl: null,
          },
        ],
        recipients: ["alex@example.com"],
        message: "Original issue",
        createdBy: "user-1",
        createdAt: when,
      },
    ];
    const createObjectURL = vi.fn((_blob: Blob) => "blob:manifest");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(screen.getByRole("tab", { name: "Transmittals" }));
    fireEvent.click(screen.getByRole("button", { name: "Download manifest" }));
    const blob = createObjectURL.mock.calls[0]![0] as Blob | undefined;
    expect(blob).toBeInstanceOf(Blob);
    const contents = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : "");
      reader.readAsText(blob!);
    });
    const manifest: unknown = JSON.parse(contents);
    expect(manifest).toMatchObject({
      id: "transmittal-1",
      documents: [
        {
          name: "Original specification.pdf",
          versionId: "version-1",
          downloadUrl: `${window.location.origin}/api/job-documents/files/version-1?jobId=job-1&download=1`,
        },
      ],
    });
    expect(posts()).toHaveLength(0);
    click.mockRestore();
  });
});
