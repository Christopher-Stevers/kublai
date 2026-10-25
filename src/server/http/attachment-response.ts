/** Call only after the feature's access checks have returned the file. */
export function safeAttachmentResponse(file: {
  mimeType: string;
  name: string;
  data: Uint8Array;
}) {
  const disposition =
    file.mimeType === "application/pdf" ? "attachment" : "inline";
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
