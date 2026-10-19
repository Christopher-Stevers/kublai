/** Lists have no trade field, so the card colour is read from the list's name. */
export type MaterialListTrade =
  | "plumbing"
  | "hvac"
  | "electrical"
  | "tools"
  | "general";

const TRADES: [Exclude<MaterialListTrade, "tools" | "general">, RegExp][] = [
  [
    "electrical",
    /electric|wiring|\bwire|breaker|\bpanel|lighting|conduit|outlet|\belec\b/i,
  ],
  [
    "hvac",
    /hvac|mechanical|\bmech\b|duct|furnace|heat ?pump|air ?handler|\ba\/?c\b|ventilat|refrigerant|mini[- ]?split|condenser/i,
  ],
  [
    "plumbing",
    /plumb|\bpex\b|drain|sewer|water|\bgas\b|fixture|\bdwv\b|faucet|toilet/i,
  ],
];

export function materialListTrade(list: {
  name: string;
  kind?: string | null;
}): MaterialListTrade {
  if (list.kind === "tools") return "tools";
  return (
    TRADES.find(([, pattern]) => pattern.test(list.name))?.[0] ?? "general"
  );
}

export const TRADE_TAB: Record<MaterialListTrade, string> = {
  plumbing: "bg-blue-500",
  hvac: "bg-teal-500",
  electrical: "bg-amber-500",
  tools: "bg-slate-500",
  general: "bg-primary/35",
};
