import type { BimModel, ModelUploadMetadata } from "./types";
async function json<T>(response: Response): Promise<T> {
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw Error(data.error ?? "The model request failed.");
  return data as T;
}
export async function uploadModel(
  file: File,
  metadata: Omit<ModelUploadMetadata, "filename" | "size">,
  onProgress: (value: number) => void,
  signal: AbortSignal,
) {
  const session = await json<{ id: string; chunkBytes: number }>(
    await fetch("/api/models/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...metadata,
        filename: file.name,
        size: file.size,
      }),
      signal,
    }),
  );
  const count = Math.ceil(file.size / session.chunkBytes);
  for (let part = 0; part < count; part++) {
    const chunk = file.slice(
      part * session.chunkBytes,
      (part + 1) * session.chunkBytes,
    );
    await json(
      await fetch(
        `/api/models/upload/${session.id}/${part}?jobId=${encodeURIComponent(metadata.jobId)}`,
        { method: "PUT", body: chunk, signal },
      ),
    );
    onProgress(Math.round(((part + 1) / count) * 95));
  }
  const model = await json<BimModel>(
    await fetch(
      `/api/models/upload/${session.id}/finish?jobId=${encodeURIComponent(metadata.jobId)}`,
      { method: "POST", signal },
    ),
  );
  onProgress(100);
  return model;
}
export const modelFileUrl = (jobId: string, id: string, source = false) =>
  `/api/models/files/${encodeURIComponent(id)}?jobId=${encodeURIComponent(jobId)}${source ? "&source=1" : ""}`;
export function downloadBlob(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
