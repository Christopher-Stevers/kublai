import { z } from "zod";

export const materialGroupPathSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine(
        (value) => !/[\/\r\n]/.test(value),
        "Group names cannot contain slashes or newlines",
      ),
  )
  .max(5);
export type GroupedMaterial = {
  id: string;
  name: string;
  count?: number;
  groupPath?: string[];
};
export function materialPath(material: GroupedMaterial): string[] {
  const result = materialGroupPathSchema.safeParse(material.groupPath ?? []);
  return result.success ? result.data : [];
}
const equalName = (a: string, b: string) =>
  a.toLocaleLowerCase() === b.toLocaleLowerCase();
export function isInMaterialGroup(path: string[], parent: string[]) {
  return (
    path.length >= parent.length &&
    parent.every((name, index) => equalName(name, path[index]!))
  );
}
export type MaterialEntry =
  | {
      kind: "group";
      key: string;
      name: string;
      path: string[];
      count: number;
      materialCount: number;
    }
  | { kind: "material"; key: string; name: string; material: GroupedMaterial };
export function materialGroupEntries(
  materials: GroupedMaterial[],
  parent: string[] = [],
): MaterialEntry[] {
  const groups = new Map<string, Extract<MaterialEntry, { kind: "group" }>>();
  const entries: MaterialEntry[] = [];
  for (const material of materials) {
    const path = materialPath(material);
    if (!isInMaterialGroup(path, parent)) continue;
    if (path.length === parent.length) {
      entries.push({
        kind: "material",
        key: `material:${material.id}`,
        name: material.name,
        material,
      });
    } else {
      const name = path[parent.length]!;
      const key = name.toLocaleLowerCase();
      const group = groups.get(key) ?? {
        kind: "group",
        key: `group:${key}`,
        name,
        path: [...parent, name],
        count: 0,
        materialCount: 0,
      };
      group.count += material.count ?? 0;
      group.materialCount++;
      groups.set(key, group);
    }
  }
  return [...groups.values(), ...entries].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

// Used only by the explicit one-time organization setup, never inferred while browsing.
export function initialPvcGroup(name: string): string[] | null {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^gasketed (?:dr|sdr)\s*(25|35)$/.test(normalized))
    return ["PVC", "Gasketed SDR"];
  if (
    normalized.startsWith("pvc ") ||
    ["xfr", "gasketed sdr", "gasketed sewer pipe", "ring-tite", "bds"].includes(
      normalized,
    )
  )
    return ["PVC"];
  return null;
}
