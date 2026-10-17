/** Keep native crashes and internal diagnostics out of the upload dialog. */
export function uploadProcessingError(message: string): string {
  if (/heap out of memory|heap limit|allocation failed|SIGKILL|SIGABRT/i.test(message))
    return "This PDF exceeded the drawing processor's memory limit. Split it into smaller PDFs and retry. Your original PDF is saved and existing drawings are unchanged.";
  const pageLimit = message.match(/^PDF has more than \d+ pages\. Split it into smaller PDFs; no sheets were added\.$/m)?.[0];
  if (pageLimit) return pageLimit;
  if (message === "File is not a PDF" || message === "PDF has no valid pages") return message;
  if (/password/i.test(message))
    return "This PDF requires a password. Upload an unlocked copy; existing drawings are unchanged.";
  return "The PDF could not be processed. Retry the upload or export a fresh PDF. Your original PDF is saved and existing drawings are unchanged.";
}
