import { DRAWING_POLL_MS } from "./drawing-upload-limits";
export type UploadedSheet = { id: string; name: string; imageUrl: string };
type UploadReply = {
  uploadId?: string;
  received?: number;
  status?: string;
  floors?: UploadedSheet[];
  error?: string;
};
const CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_BYTES = 100 * 1024 * 1024;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export class UploadResponseError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function readUploadResponse(
  response: Response,
): Promise<UploadReply> {
  const text = await response.text();
  let body: UploadReply | undefined;
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      body = JSON.parse(text) as UploadReply;
    } catch {
      /* upstream truncated response */
    }
  }
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    const message =
      body && typeof body.error === "string"
        ? body.error
        : `Upload server returned HTTP ${response.status}${text.trim() ? " without valid JSON" : " with an empty response"}. Retry to resume; existing drawings are unchanged.`;
    throw new UploadResponseError(message, response.status);
  }
  return body;
}
async function request(url: string, init?: RequestInit): Promise<UploadReply> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await readUploadResponse(
        await fetch(url, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        }),
      );
    } catch (error) {
      last = error;
      if (
        error instanceof UploadResponseError &&
        ![408, 409, 429, 500, 502, 503, 504, 520, 522, 524].includes(
          error.status,
        )
      )
        throw error;
      if (attempt < 3) await pause(3000 * (attempt + 1));
    }
  }
  throw last;
}
export async function uploadDrawings(
  jobId: string,
  file: File,
): Promise<UploadedSheet[]> {
  if (
    !file.name.toLowerCase().endsWith(".pdf") ||
    file.size < 5 ||
    file.size > MAX_BYTES
  )
    throw new Error("Choose a PDF up to 100 MB");
  const endpoint = "/api/job-rooms/upload";
  const storageKey = `drawing-upload:${jobId}:${file.name}:${file.size}:${file.lastModified}`;
  let uploadId: string | null = null;
  try {
    uploadId = localStorage.getItem(storageKey);
  } catch {
    /* private mode */
  }
  let state: UploadReply | undefined;
  if (uploadId) {
    try {
      state = await request(
        `${endpoint}?uploadId=${encodeURIComponent(uploadId)}`,
      );
    } catch (e) {
      if (!(e instanceof UploadResponseError) || e.status !== 404) throw e;
      uploadId = null;
    }
  }
  if (!uploadId) {
    const started = await request(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, filename: file.name, size: file.size }),
    });
    if (!started.uploadId)
      throw new Error("Upload server did not return an upload id");
    uploadId = started.uploadId;
    try {
      localStorage.setItem(storageKey, uploadId);
    } catch {
      /* uploads still work without storage */
    }
  }
  if (state?.status === "error") {
    // The source PDF is retained after worker failures. Retry that exact upload
    // instead of trapping the browser on a persisted, now-obsolete error.
    state = await request(
      `${endpoint}?uploadId=${encodeURIComponent(uploadId)}&action=retry`,
      { method: "POST" },
    );
  }
  if (!state || state.status === "receiving") {
    // Replay from zero: server verifies retries byte-for-byte, avoiding mixed-file resumes.
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      await request(
        `${endpoint}?uploadId=${encodeURIComponent(uploadId)}&offset=${offset}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(offset, offset + CHUNK_BYTES),
        },
      );
    }
    await request(
      `${endpoint}?uploadId=${encodeURIComponent(uploadId)}&action=finish`,
      { method: "POST" },
    );
  }
  const deadline = Date.now() + DRAWING_POLL_MS;
  while (Date.now() < deadline) {
    const result = await request(
      `${endpoint}?uploadId=${encodeURIComponent(uploadId)}`,
    );
    if (result.status === "ready") {
      if (
        !Array.isArray(result.floors) ||
        !result.floors.length ||
        result.floors.some(
          (s) =>
            typeof s.id !== "string" ||
            typeof s.name !== "string" ||
            typeof s.imageUrl !== "string",
        )
      )
        throw new Error("Upload server returned invalid drawing data");
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* private mode */
      }
      return result.floors;
    }
    if (result.status === "error")
      throw new Error(
        result.error ??
          "PDF processing failed; existing drawings are unchanged",
      );
    await pause(2000);
  }
  throw new Error(
    "PDF is still processing. Select the same file to resume checking; do not delete existing drawings.",
  );
}
