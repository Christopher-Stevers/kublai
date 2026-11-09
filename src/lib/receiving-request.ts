/** Only use for receiving mutations carrying a server-deduplicated requestId. */
export async function receivingRequest(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init);
      if (attempt === 2 || ![502, 503, 504].includes(response.status)) return response;
      await response.body?.cancel();
    } catch (error) {
      if (attempt === 2) throw new Error("The connection was interrupted. Use Retry request to safely retry the same change.", { cause: error });
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
}

export async function receivingResponse<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.redirected) {
    throw new Error("Your session may have expired. Sign in again, then retry this change.");
  }
  let data: unknown;
  try { data = await response.json(); }
  catch {
    throw new Error("The server returned an unexpected response, possibly during an update. Use Retry request to safely retry the same change.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("The server returned an invalid response. Retry this request.");
  return data as T;
}
