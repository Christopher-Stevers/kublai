export const MAX_DRAWING_PACKAGE_BYTES = 128 * 1024 * 1024;

export async function pdfBytes(
  url: string,
  signal?: AbortSignal,
  resolveSource?: (url: string) => Promise<string>,
  maxBytes = 256 * 1024 * 1024,
) {
  signal?.throwIfAborted();
  const source = resolveSource ? await resolveSource(url) : url;
  const response = await fetch(source, { credentials: "same-origin", signal });
  if (!response.ok)
    throw new Error(`Could not download the drawing (${response.status}).`);
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error(
      "The selected PDFs exceed the export size limit. Export a smaller selection.",
    );
  }
  // Missing or inaccurate Content-Length must not allocate an unbounded PDF.
  // Keep the arrayBuffer fallback for response adapters without a byte stream.
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes)
      throw new Error(
        "The selected PDFs exceed the export size limit. Export a smaller selection.",
      );
    signal?.throwIfAborted();
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes)
        throw new Error(
          "The selected PDFs exceed the export size limit. Export a smaller selection.",
        );
      chunks.push(value);
    }
    signal?.throwIfAborted();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
