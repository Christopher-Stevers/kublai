import type { VoiceTool } from "./policy";
export type Candidate = { id: string; name: string; jobId?: string };
export type Evidence = {
  groups: Record<string, Candidate[]>;
  selected: string[];
  questionKind?: string;
};
export const newEvidence = (): Evidence => ({ groups: {}, selected: [] });
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function selectFromAnswer(e: Evidence, text: string) {
  const input = ` ${normalize(text)} `;
  for (const group of Object.values(e.groups)) {
    for (const c of group) {
      if (
        input.includes(` ${normalize(c.name)} `) &&
        group.filter((x) => normalize(x.name) === normalize(c.name)).length ===
          1
      )
        e.selected.push(c.id);
    }
  }
  if (e.questionKind) {
    const match =
      /^(?:the |option |number )?(first|second|third|fourth|fifth|[1-5])(?: one)?[.!]?$/i.exec(
        text.trim(),
      );
    const index = match
      ? ["first", "second", "third", "fourth", "fifth"].indexOf(
          match[1]!.toLowerCase(),
        )
      : -1;
    const picked = match
      ? e.groups[e.questionKind]?.[index < 0 ? Number(match[1]) - 1 : index]
      : null;
    if (picked) e.selected.push(picked.id);
  }
  e.selected = [...new Set(e.selected)];
}
export function rememberCandidates(
  e: Evidence,
  kind: string,
  rows: unknown,
  request: string,
) {
  if (!Array.isArray(rows)) return;
  const candidates = rows.filter(
    (r: unknown): r is Candidate =>
      !!r &&
      typeof r === "object" &&
      "id" in r &&
      "name" in r &&
      typeof r.id === "string" &&
      typeof r.name === "string",
  );
  // A multi-result lookup never authorizes the model to silently select one.
  e.groups[kind] = candidates;
  if (candidates.length === 1) e.selected.push(candidates[0]!.id);
  selectFromAnswer(e, request);
}
export function clarifyBeforeAction(
  e: Evidence,
  tool: VoiceTool,
  page: string,
): string | undefined {
  if (tool.tool !== "navigate" && tool.tool !== "change") return;
  if (
    tool.tool === "navigate" &&
    [
      "job",
      "material-lists",
      "drawings",
      "documents",
      "rooms",
      "systems",
      "models",
      "receiving",
      "pricing",
      "tool-requests",
      "job-chat",
    ].includes(tool.destination) &&
    !tool.jobId
  ) {
    const rows = e.groups.jobs ?? [];
    if (rows.length > 1 && rows.length <= 5) {
      e.questionKind = "jobs";
      return `Which job do you mean: ${rows.map((r, i) => `${i + 1}, ${r.name}`).join("; ")}?`;
    }
    return "Which job should I open?";
  }
  const source = tool.tool === "change" ? tool.change : tool;
  const ids = Object.entries(source)
    .filter(([k]) => k.endsWith("Id") || k === "id")
    .map(([, v]) => v as string);
  for (const id of ids) {
    if (e.selected.includes(id) || page.split(/[/?#]/).includes(id)) continue;
    const group = Object.entries(e.groups).find(([, rows]) =>
      rows.some((r) => r.id === id),
    );
    if (!group)
      return "Which item do you mean? Please give me its name so I can look it up first.";
    const [kind, rows] = group;
    if (rows.length > 1) {
      e.questionKind = kind;
      return rows.length > 5
        ? `I found ${rows.length} possible ${kind}. Which exact name, size, or number do you mean?`
        : `Which ${kind === "jobs" ? "job" : kind === "parts" ? "part" : "one"} do you mean: ${rows.map((r, i) => `${i + 1}, ${r.name}`).join("; ")}?`;
    }
  }
}

export function completeNavigation(
  e: Evidence,
  tool: VoiceTool,
  page: string,
  request = "",
): VoiceTool {
  if (tool.tool !== "navigate" || tool.jobId) return tool;
  const jobPages = [
    "job",
    "material-lists",
    "drawings",
    "documents",
    "rooms",
    "systems",
    "models",
    "receiving",
    "pricing",
    "tool-requests",
    "job-chat",
  ];
  if (!jobPages.includes(tool.destination)) return tool;
  const choices = (e.groups.jobs ?? []).filter((c) =>
    e.selected.includes(c.id),
  );
  const pageJob = /^\/jobs\/([0-9a-f-]{36})(?:\/|$)/i.exec(page)?.[1];
  const jobId =
    /\b(this|current|here)\b/i.test(request) && pageJob
      ? pageJob
      : choices.length === 1
        ? choices[0]!.id
        : (e.groups.jobs?.length ?? 0) > 1
          ? undefined
          : pageJob;
  return jobId ? { ...tool, jobId } : tool;
}

/** Missing amounts are a question, never the model's default of one. */
export function quantityQuestion(
  tool: VoiceTool,
  requests: string[],
): string | undefined {
  if (tool.tool !== "change" || !("quantity" in tool.change)) return;
  const desired = tool.change.quantity;
  const units: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };
  for (const request of requests) {
    const text = request
      .toLowerCase()
      .replace(
        /\b(?:\d+(?:[./]\d+)?|one|two|three|four|five|six|eight|ten|twelve)[ -]*(?:inch(?:es)?|mm|millimet(?:er|re)s?|["″])/g,
        " ",
      );
    if (
      (text.match(/\b\d+(?:\.\d+)?\b/g) ?? []).some(
        (n) => Number(n) === desired,
      )
    )
      return;
    let sum = 0;
    for (const token of (text + " end").split(/[\s,-]+/)) {
      if (units[token]) sum += units[token];
      else if (token === "hundred" && sum) sum *= 100;
      else if (token === "thousand" && sum) sum *= 1000;
      else if (token !== "and") {
        if (sum === desired) return;
        sum = 0;
      }
    }
  }
  return "What quantity do you want? Please tell me the amount and unit.";
}
