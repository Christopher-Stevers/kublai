import { createHash } from "node:crypto";
import { askJev, type DecisionRequest } from "./jev";
import { AsyncResultCache } from "./cache";
const results = new AsyncResultCache<Awaited<ReturnType<typeof askJev>>>();

export function askJevCached(organizationId: string, request: DecisionRequest) {
  // Exact state/questions include every retrieved candidate and source field.
  // Key rotation, question changes, and model changes invalidate the cache.
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        organizationId,
        process.env.TYPESAFE_API_KEY,
        process.env.TYPESAFE_MODEL?.trim() || "jev-latest",
        request,
      ]),
    )
    .digest("hex");
  return results.get(key, () => askJev(request));
}
