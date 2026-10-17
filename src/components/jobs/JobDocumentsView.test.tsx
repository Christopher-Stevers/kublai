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
vi.mock("./documents/DocumentPdfPreview", async () => {
  const { useEffect } = await import("react");
  return {
    DocumentPdfPreview: ({
      url,
      title,
      onReady,
      onDocumentDetails,
      onClose,
    }: {
      url: string;
      title: string;
      onReady?: () => void;
      onDocumentDetails?: () => void;
      onClose?: () => void;
    }) => {
      useEffect(() => {
        onReady?.();
      }, [onReady]);
      return <><iframe title={title} src={url} />{onDocumentDetails && <button onClick={onDocumentDetails}>Document details</button>}{onClose && <button onClick={onClose}>Close</button>}</>;
    },
  };
});
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
afterEach(async () => {
  window.history.replaceState(null, "", "/");
  cleanup();
  // Radix restores focus on the next task; finish before jsdom is disposed.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

describe("job documents workspace", () => {
  it("opens PDFs full screen and keeps their document tools behind Details", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Specification.pdf" }),
    );
    expect(
      screen.getByRole("region", { name: "Specification.pdf" }),
    ).toHaveClass("fixed", "top-14", "bottom-0");
    expect(
      screen.queryByRole("toolbar", { name: "Document controls" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "versions" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
    expect(screen.getByRole("tab", { name: "versions" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(
      screen.getByRole("region", { name: "Specification.pdf" }),
    ).toHaveClass("top-14", "bottom-0");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.getByRole("toolbar", { name: "Document controls" }),
    ).toBeVisible();
  });
  it("opens an accessible document from a drawing link in its own folder", async () => {
    window.history.replaceState(null, "", "/?document=doc-2");
    render(<JobDocumentsView jobId="job-1" />);
    expect(
      await screen.findByRole("dialog", { name: "Agreement.docx" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open Agreement.docx" }),
    ).toBeInTheDocument();
  });
  it("does not expose a missing or inaccessible document from a drawing link", async () => {
    window.history.replaceState(null, "", "/?document=hidden");
    render(<JobDocumentsView jobId="job-1" />);
    expect(
      await screen.findByText(
        "This document is unavailable or you do not have access to it.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
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
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.change(screen.getByLabelText("Filter by file type"), {
      target: { value: "word" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("No matching documents")).toBeInTheDocument();
  });

  it("creates a folder and uploads a file into the open folder", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Contracts" }));
    fireEvent.click(screen.getByRole("button", { name: "More" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
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
    fireEvent.click(screen.getByRole("button", { name: "More" }));
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
    fireEvent.click(screen.getByRole("button", { name: "More" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
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
    fireEvent.click(screen.getByRole("button", { name: "More" }));
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
  it.each([
    { label: "New Word document", kind: "word", name: "Site notes.docx" },
    { label: "New spreadsheet", kind: "spreadsheet", name: "Budget.xlsx" },
  ])(
    "creates and opens a $kind file in the configured open-source editor",
    async ({ label, kind, name }) => {
      const formSubmit = vi
        .spyOn(HTMLFormElement.prototype, "submit")
        .mockImplementation(() => undefined);
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        const requestUrl =
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        requests.push({ url: requestUrl, init });
        if (requestUrl.includes("/editor/new")) {
          overview.documents.push(
            doc({
              id: "created-doc",
              name,
              currentVersionId: "created-version",
            }),
          );
          return new Response(
            JSON.stringify({
              documentId: "created-doc",
              versionId: "created-version",
            }),
            { status: 201 },
          );
        }
        if (requestUrl.includes("/editor") && init?.method === "POST")
          return new Response(
            JSON.stringify({
              provider: "collabora",
              mode: "edit",
              actionUrl:
                "https://office.example.com/browser/editor.html?WOPISrc=example",
              wopiSrc: "https://example.com/wopi",
              accessToken: "test-secret",
              accessTokenTtl: Date.now() + 7_200_000,
              documentId: "created-doc",
              versionId: "created-version",
            }),
          );
        if (requestUrl.includes("/editor"))
          return new Response(
            JSON.stringify({ configured: true, provider: "collabora" }),
          );
        return new Response(JSON.stringify(overview));
      });
      render(<JobDocumentsView jobId="job-1" />);
      await ready();
      fireEvent.click(
        screen.getByRole("button", { name: "Add document" }),
      );
      fireEvent.click(await screen.findByRole("button", { name: label }));
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: name },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create and edit" }));
      expect(await screen.findByTitle(`Edit ${name}`)).toBeInTheDocument();
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        folderId: null,
        kind,
        name,
      });
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        documentId: "created-doc",
      });
      expect(formSubmit).toHaveBeenCalledTimes(1);
      formSubmit.mockRestore();
    },
  );

  it("does not offer live creation when the editing service is not configured", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    fireEvent.click(
      screen.getByRole("button", { name: "Add document" }),
    );
    expect(
      screen.getByText(/Online Word and spreadsheet editing is not set up/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New Word document" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New spreadsheet" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Contracts" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Open Agreement.docx" }),
    );
    expect(
      screen.getByText(/Live editing is not set up on this server/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit together" }),
    ).not.toBeInTheDocument();
  });
});

function submittalDoc(overrides: Partial<JobDocument> = {}) {
  const id = overrides.id ?? "submittal-1";
  overview.versions.push(
    ...overview.versions
      .filter((version) => version.documentId === "doc-1")
      .map((version) => ({
        ...version,
        id: `${id}-v${version.number}`,
        documentId: id,
      })),
  );
  return doc({
    id,
    currentVersionId: `${id}-v2`,
    name: "SUB-001 · valve.pdf",
    submittal: {
      number: "SUB-001",
      title: "Valve product data",
      category: "Plumbing",
      specSection: "22 11 16",
      manufacturer: "Acme",
      dueDate: "2026-01-01",
    },
    ...overrides,
  });
}
function pendingSubmittal() {
  const document = submittalDoc();
  overview.documents.push(document);
  overview.reviews.push({
    id: "review-submittal",
    title: "Valve approval",
    documents: [
      {
        documentId: document.id,
        versionId: document.currentVersionId,
        name: document.name,
        officeWebUrl: null,
      },
    ],
    reviewerId: "user-1",
    status: "pending",
    comment: "",
    createdBy: "user-2",
    createdAt: when,
    resolvedAt: null,
  });
}
async function openSubmittals() {
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("tab", { name: "Submittals" }));
}
describe("dedicated submittal workspace", () => {
  it("keeps submittals out of ordinary files, filters attention and specifications, and previews PDFs", async () => {
    pendingSubmittal();
    overview.documents.push(
      submittalDoc({
        id: "submittal-2",
        name: "SUB-002 · motor.pdf",
        submittal: {
          number: "SUB-002",
          title: "Motor",
          category: "Electrical",
          manufacturer: "",
          specSection: "",
          dueDate: null,
        },
      }),
    );
    render(<JobDocumentsView jobId="job-1" />);
    await ready();
    expect(
      screen.queryByRole("button", { name: "Open SUB-001 · valve.pdf" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("tab", { name: "Submittals" }));
    expect(
      screen.getByRole("button", { name: "Open SUB-002: Motor" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Needs your review/ }));
    expect(
      screen.queryByRole("button", { name: "Open SUB-002: Motor" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search submittals"), {
      target: { value: "22 11 16" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open SUB-001: Valve product data" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
    expect(
      screen.getByTitle("Preview SUB-001 · valve.pdf version 2"),
    ).toHaveAttribute(
      "src",
      "/api/job-documents/files/submittal-1-v2?jobId=job-1",
    );
    expect(screen.getByRole("link", { name: "Open PDF" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Request review" }),
    ).not.toBeInTheDocument();
  });
  it("uploads PDFs into the register, preserves later files when a selection includes a non-PDF, and uses PDF-only picker", async () => {
    render(<JobDocumentsView jobId="job-1" />);
    await openSubmittals();
    fireEvent.click(screen.getByRole("button", { name: "Upload PDFs" }));
    expect(screen.getByLabelText("Upload document files")).toHaveAttribute(
      "accept",
      ".pdf,application/pdf",
    );
    fireEvent.change(screen.getByLabelText("Upload document files"), {
      target: {
        files: [
          new File(["not pdf"], "bad.txt"),
          new File(["%PDF-1.7"], "Pump_data.pdf", { type: "application/pdf" }),
        ],
      },
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = posts()[0]!.init!.body as FormData;
    expect(
      JSON.parse(body.get("submittal") as string) as unknown,
    ).toMatchObject({
      title: "Pump data",
      dueDate: null,
    });
    expect(body.get("folderId")).toBeNull();
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("bad.txt");
  });
  it("allows assigned read-only reviewers to approve and requires a reason for returning", async () => {
    pendingSubmittal();
    overview.capabilities.canWrite = false;
    overview.capabilities.canManage = false;
    overview.documents = overview.documents.map((document) => ({
      ...document,
      canWrite: false,
      canManage: false,
    }));
    render(<JobDocumentsView jobId="job-1" />);
    await openSubmittals();
    expect(
      screen.queryByRole("button", { name: "Upload PDFs" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open SUB-001: Valve product data" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
    fireEvent.click(screen.getByRole("button", { name: "Return for changes" }));
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Describe the changes");
    fireEvent.change(screen.getByLabelText("Review comments"), {
      target: { value: "Use the correct rating" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Return for changes" }));
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        action: "resolveReview",
        reviewId: "review-submittal",
        decision: "changes_requested",
        comment: "Use the correct rating",
      }),
    );
  });
  it("prevents approval while an old PDF revision is displayed", async () => {
    pendingSubmittal();
    render(<JobDocumentsView jobId="job-1" />);
    await openSubmittals();
    fireEvent.click(
      screen.getByRole("button", { name: "Open SUB-001: Valve product data" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
    fireEvent.click(screen.getByRole("tab", { name: "versions" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview v1" }));
    expect(screen.getByRole("button", { name: "Approve PDF" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Return to current version" }),
    );
    expect(screen.getByRole("button", { name: "Approve PDF" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Approve PDF" }));
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual({
        jobId: "job-1",
        action: "resolveReview",
        reviewId: "review-submittal",
        decision: "approved",
        comment: "",
      }),
    );
  });
  it("saves submittal metadata with a conflict token and requests an assigned approval", async () => {
    overview.documents.push(submittalDoc());
    render(<JobDocumentsView jobId="job-1" />);
    await openSubmittals();
    fireEvent.click(
      screen.getByRole("button", { name: "Open SUB-001: Valve product data" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Document details" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Correct valve" },
    });
    fireEvent.change(screen.getByLabelText("Approval due date"), {
      target: { value: "2026-10-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual(
        expect.objectContaining({
          action: "updateSubmittal",
          expectedUpdatedAt: when,
          details: {
            title: "Correct valve",
            category: "Plumbing",
            manufacturer: "Acme",
            specSection: "22 11 16",
            dueDate: "2026-10-31",
          },
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Save details" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("Send for approval"), {
      target: { value: "user-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    await waitFor(() =>
      expect(jsonPosts()).toContainEqual(
        expect.objectContaining({
          action: "createReview",
          reviewerId: "user-2",
          documentIds: ["submittal-1"],
        }),
      ),
    );
  });
});

it("routes grouped approvals through the full review instead of approving unseen PDFs", async () => {
  pendingSubmittal();
  overview.reviews[0]!.documents.push({
    documentId: "doc-1",
    versionId: "version-2",
    name: "Specification.pdf",
    officeWebUrl: null,
  });
  render(<JobDocumentsView jobId="job-1" />);
  await openSubmittals();
  fireEvent.click(
    screen.getByRole("button", { name: "Open SUB-001: Valve product data" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Document details" }));
  expect(
    screen.queryByRole("button", { name: "Approve PDF" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open grouped review" }));
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.getByRole("tab", { name: "Reviews" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    screen.getByRole("button", { name: "Complete review" }),
  ).toBeInTheDocument();
});

it("keeps the document workspace focused on the bottom controls", async () => {
  render(<JobDocumentsView jobId="job-1" />);
  await ready();
  const toolbar = screen.getByRole("toolbar", { name: "Document controls" });
  expect(toolbar.querySelectorAll("button")).toHaveLength(2);
  expect(
    toolbar.contains(screen.getByRole("textbox", { name: "Search documents" })),
  ).toBe(true);
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "New folder" }),
  ).not.toBeInTheDocument();
});

it("moves selected files to a chosen folder in one request", async () => {
  overview.documents.push(doc({ id: "doc-extra", name: "Second.pdf" }));
  render(<JobDocumentsView jobId="job-1" />);
  await ready();
  fireEvent.click(screen.getByLabelText("Select Specification.pdf"));
  fireEvent.click(screen.getByLabelText("Select Second.pdf"));
  fireEvent.click(screen.getByRole("button", { name: "Move" }));
  fireEvent.change(screen.getByLabelText("Destination folder"), { target: { value: "folder-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(jsonPosts()).toContainEqual({ jobId: "job-1", action: "moveDocuments", documentIds: ["doc-1", "doc-extra"], folderId: "folder-1" }));
});
