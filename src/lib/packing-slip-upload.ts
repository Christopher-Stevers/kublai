/** Bound the entire upload, including reading the server response. Never retry a
 * POST automatically: a lost response can still mean the document was saved. */
export async function uploadPackingSlip<T>(url: string, form: FormData): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Saving took too long. Your scan is still available here. Check saved packing slips before retrying: the server may have received it."));
      controller.abort();
    }, 90_000);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
        const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
        if (!response.ok || !result) {
          throw new Error(result?.error ?? `Could not confirm the save (HTTP ${response.status}). Your scan is retained. Check saved packing slips before retrying.`);
        }
        return result;
      })(),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
