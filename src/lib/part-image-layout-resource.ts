export type PartImageLayout = {
  width: number;
  height: number;
  box: number[];
  background: string | null;
};
type Layouts = Record<string, PartImageLayout>;
let cached: Layouts | undefined;
let pending: Promise<Layouts> | undefined;

/** Only local catalogue resources can appear in the audited metadata. */
export function isCatalogueImageSource(source: string) {
  return /^\/api\/catalogue\/images\/[^/?#]+$/.test(source);
}
export function cachedPartImageLayouts() {
  return cached;
}
export function loadPartImageLayouts(): Promise<Layouts> {
  if (cached) return Promise.resolve(cached);
  return (pending ??= import("./part-image-layouts.json").then(
    (module) => {
      cached = module.default as Layouts;
      pending = undefined;
      return cached;
    },
    (error: unknown) => {
      pending = undefined;
      throw error;
    },
  ));
}
