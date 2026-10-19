import type { DrawingMarkup } from "./drawing-workspace";
export function measurementLayerNames(data: Pick<DrawingMarkup, "layer" | "layers">): string[] {
  return [...new Set(data.layers?.length ? data.layers : [data.layer ?? "General"])];
}
export function measurementLayerVisible(data: Pick<DrawingMarkup, "layer" | "layers">, hidden: string[]): boolean {
  return measurementLayerNames(data).some(name => !hidden.includes(name));
}
