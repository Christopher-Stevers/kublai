/** A single HTTP byte range; multiple/unknown range units use a normal 200. */
export function singleByteRange(value: string | null, size: number) {
  if (!value || !value.startsWith("bytes=") || value.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last)) ||
    size === 0
  )
    return "unsatisfiable" as const;
  if (first === null) {
    if (!last) return "unsatisfiable" as const;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first))
    return "unsatisfiable" as const;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

export function isNotModified(headers: Headers, etag: string, modified: Date) {
  const tags = headers.get("if-none-match");
  if (tags !== null)
    return tags.split(",").some((tag) => {
      const value = tag.trim();
      return value === "*" || value.replace(/^W\//, "") === etag;
    });
  const since = headers.get("if-modified-since");
  return (
    since !== null &&
    Math.floor(modified.getTime() / 1000) <= Date.parse(since) / 1000
  );
}

export function rangeMatches(headers: Headers, etag: string, modified: Date) {
  const condition = headers.get("if-range");
  if (condition === null) return true;
  if (condition.startsWith('"')) return condition === etag;
  // If-Range requires strong matching; weak ETags never permit partial bytes.
  return (
    !condition.startsWith("W/") &&
    Date.parse(condition) === Math.floor(modified.getTime() / 1000) * 1000
  );
}
