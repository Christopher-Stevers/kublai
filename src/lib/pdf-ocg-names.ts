/** Some CAD exports mark page content with optional content groups (layers)
 * that the catalog's /OCProperties never lists. pdf.js then knows only the
 * object id ("1394R"), so read the group's /Name straight from the file:
 * plain objects and Flate-compressed object streams. Keys use pdf.js's
 * reference format. Later definitions (incremental updates) win. */

const MAX_STREAMS = 5000;
const MAX_INFLATED = 64 * 1024 * 1024;

const refKey = (num: number, gen: number) =>
  gen === 0 ? `${num}R` : `${num}R${gen}`;

function decodeName(raw: string): string | undefined {
  let bytes: number[] = [];
  if (raw.startsWith("<")) {
    const hex = raw.slice(1, -1).replace(/[^0-9a-f]/gi, "");
    for (let i = 0; i < hex.length; i += 2)
      bytes.push(parseInt(hex.slice(i, i + 2).padEnd(2, "0"), 16));
  } else {
    const body = raw.slice(1, -1);
    const escapes: Record<string, number> = {
      n: 10,
      r: 13,
      t: 9,
      b: 8,
      f: 12,
    };
    for (let i = 0; i < body.length; i++) {
      const c = body[i]!;
      if (c !== "\\") {
        bytes.push(c.charCodeAt(0) & 0xff);
        continue;
      }
      const next = body[++i];
      if (next === undefined) break;
      const octal = /^[0-7]{1,3}/.exec(body.slice(i, i + 3))?.[0];
      if (octal) {
        bytes.push(parseInt(octal, 8) & 0xff);
        i += octal.length - 1;
      } else if (next === "\r" || next === "\n") {
        if (next === "\r" && body[i + 1] === "\n") i++;
      } else bytes.push(escapes[next] ?? next.charCodeAt(0));
    }
  }
  let text = "";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    bytes = bytes.slice(2);
    for (let i = 0; i + 1 < bytes.length; i += 2)
      text += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  } else text = String.fromCharCode(...bytes);
  return text.trim() || undefined;
}

/** Read /Name from one optional content group dictionary, if it is one. */
function ocgName(dict: string): string | undefined {
  if (!/\/Type\s*\/OCG(?![A-Za-z])/.test(dict)) return undefined;
  const at = /\/Name\s*([(<])/.exec(dict);
  if (!at) return undefined;
  const start = at.index + at[0].length - 1;
  if (at[1] === "<") {
    const end = dict.indexOf(">", start);
    return end > start ? decodeName(dict.slice(start, end + 1)) : undefined;
  }
  let depth = 0;
  for (let i = start; i < dict.length && i < start + 2000; i++) {
    const c = dict[i];
    if (c === "\\") i++;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0)
      return decodeName(dict.slice(start, i + 1));
  }
  return undefined;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

const latin1 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
};

export async function pdfOptionalContentNames(
  data: Uint8Array,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const text = latin1(data);
  // Uncompressed objects.
  for (let at = text.indexOf("/OCG"); at >= 0; at = text.indexOf("/OCG", at + 4)) {
    const head = text.slice(Math.max(0, at - 2000), at);
    const obj = /(\d+)\s+(\d+)\s+obj\s*<<(?![\s\S]*\bendobj\b)[\s\S]*$/.exec(head);
    if (!obj) continue;
    const end = text.indexOf(">>", at);
    const name = end > 0 ? ocgName(text.slice(at - (head.length - obj.index), end + 2)) : undefined;
    if (name) names.set(refKey(Number(obj[1]), Number(obj[2])), name);
  }
  // Compressed object streams.
  let streams = 0,
    inflated = 0;
  for (
    let at = text.indexOf("/ObjStm");
    at >= 0 && streams < MAX_STREAMS && inflated < MAX_INFLATED;
    at = text.indexOf("/ObjStm", at + 7)
  ) {
    const open = text.lastIndexOf("<<", at);
    const keyword = text.indexOf("stream", at);
    if (open < 0 || at - open > 1000 || keyword < 0 || keyword - at > 1000)
      continue;
    const dict = text.slice(open, keyword);
    if (
      !/\/Filter\s*\/FlateDecode/.test(dict) ||
      /\/DecodeParms|\/Filter\s*\[/.test(dict)
    )
      continue;
    const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1]),
      count = Number(/\/N\s+(\d+)/.exec(dict)?.[1]);
    if (!(first > 0) || !(count > 0)) continue;
    let start = keyword + 6;
    if (text[start] === "\r") start++;
    if (text[start] === "\n") start++;
    const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1];
    const stop = direct ? start + Number(direct) : text.indexOf("endstream", start);
    if (stop <= start || stop > data.length) continue;
    streams++;
    const body = await inflate(data.subarray(start, stop));
    if (!body) continue;
    inflated += body.length;
    const content = latin1(body);
    if (!content.includes("/OCG")) continue;
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count && 2 * i + 1 < header.length; i++) {
      const from = first + header[2 * i + 1]!;
      const to =
        2 * i + 3 < header.length ? first + header[2 * i + 3]! : content.length;
      const name = ocgName(content.slice(from, to));
      if (name) names.set(refKey(header[2 * i]!, 0), name);
    }
  }
  return names;
}

/** pdf.js reports a layer it could not name by its bare object id. */
export const unnamedLayer = (layer?: string) => /^\d+R\d*$/.test(layer ?? "");

const cache = new WeakMap<object, Promise<Map<string, string>>>();

/** Names for the page's optional content groups that pdf.js cannot resolve,
 * read from the PDF bytes only when at least one such group is in use. */
export async function fallbackLayerNames(
  document: { getData(): Promise<Uint8Array> },
  operators: { fnArray: number[]; argsArray: unknown[] },
  beginMarkedContentProps: number,
  optional: { getGroup(id: string): unknown },
): Promise<Map<string, string>> {
  const missing = operators.fnArray.some((fn, i) => {
    if (fn !== beginMarkedContentProps) return false;
    const [tag, props] = (operators.argsArray[i] ?? []) as [
      unknown,
      { type?: unknown; id?: unknown } | null,
    ];
    if (tag !== "OC" || props?.type !== "OCG" || typeof props.id !== "string")
      return false;
    try {
      return !(optional.getGroup(props.id) as { name?: unknown } | null)?.name;
    } catch {
      return true;
    }
  });
  if (!missing) return new Map();
  let names = cache.get(document);
  if (!names) {
    names = document
      .getData()
      .then(pdfOptionalContentNames)
      .catch(() => new Map<string, string>());
    cache.set(document, names);
  }
  return names;
}
