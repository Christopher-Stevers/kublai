/** Shared browser download for small, explicit report exports. */
export function downloadReport(filename: string, text: string) {
  const url = URL.createObjectURL(
    new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
