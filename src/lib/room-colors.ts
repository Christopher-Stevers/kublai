export type RoomColor = {
  fill: string;
  border: string;
  swatch: string;
  text: string;
};

export const ROOM_COLORS: RoomColor[] = [
  { fill: "rgba(239, 68, 68, 0.38)", border: "#dc2626", swatch: "#ef4444", text: "#7f1d1d" },
  { fill: "rgba(59, 130, 246, 0.38)", border: "#2563eb", swatch: "#3b82f6", text: "#1e3a8a" },
  { fill: "rgba(34, 197, 94, 0.38)", border: "#16a34a", swatch: "#22c55e", text: "#14532d" },
  { fill: "rgba(168, 85, 247, 0.38)", border: "#7c3aed", swatch: "#a855f7", text: "#581c87" },
  { fill: "rgba(249, 115, 22, 0.40)", border: "#ea580c", swatch: "#f97316", text: "#7c2d12" },
  { fill: "rgba(20, 184, 166, 0.38)", border: "#0f766e", swatch: "#14b8a6", text: "#134e4a" },
  { fill: "rgba(236, 72, 153, 0.38)", border: "#db2777", swatch: "#ec4899", text: "#831843" },
  { fill: "rgba(99, 102, 241, 0.38)", border: "#4f46e5", swatch: "#6366f1", text: "#312e81" },
  { fill: "rgba(180, 83, 9, 0.38)", border: "#b45309", swatch: "#d97706", text: "#78350f" },
  { fill: "rgba(107, 114, 128, 0.40)", border: "#4b5563", swatch: "#6b7280", text: "#111827" },
  { fill: "rgba(8, 145, 178, 0.38)", border: "#0e7490", swatch: "#06b6d4", text: "#164e63" },
  { fill: "rgba(132, 204, 22, 0.38)", border: "#65a30d", swatch: "#84cc16", text: "#365314" },
];

export function getRoomColor(index: number): RoomColor {
  return ROOM_COLORS[index % ROOM_COLORS.length]!;
}
