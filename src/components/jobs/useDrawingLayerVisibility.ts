"use client";
import { useCallback, useMemo } from "react";
import { createAccountPreference } from "~/hooks/create-account-preference";

export type DrawingLayers = {
  /** Versioned once-off reset; later choices must survive reopening. */
  hyperlinkVisibilityVersion?: 1;
  markups: boolean;
  issues: boolean;
  private: boolean;
  published: boolean;
  measurements?: boolean;
  hidden?: string[];
  /** Authors whose markups, measurements and pins are switched off. */
  hiddenPeople?: string[];
  /** Hides everyone else's work, including people who draw later. */
  onlyMine?: boolean;
};
const defaults: DrawingLayers = {
  markups: true,
  issues: true,
  private: true,
  published: true,
};
const usePreference = createAccountPreference<string>({
  keyFor: (key) => `foremanhq:drawing-layers:${key}`,
  initial: "",
  valid: (value): value is string => {
    if (value === "") return true;
    if (!value) return false;
    try {
      const v = JSON.parse(value) as DrawingLayers;
      return (
        v !== null &&
        [v.markups, v.issues, v.private, v.published].every(
          (x) => typeof x === "boolean",
        ) &&
        [v.measurements, v.onlyMine].every(
          (x) => x === undefined || typeof x === "boolean",
        ) &&
        [v.hidden, v.hiddenPeople].every(
          (list) =>
            list === undefined ||
            (Array.isArray(list) && list.every((x) => typeof x === "string")),
        )
      );
    } catch {
      return false;
    }
  },
});
/** Old settings (including shared page snapshots) start with links off once. */
function migrateLayers(value: DrawingLayers): DrawingLayers {
  if (value.hyperlinkVisibilityVersion === 1) return value;
  return {
    ...value,
    hyperlinkVisibilityVersion: 1,
    hidden: [...new Set([...(value.hidden ?? []), "link"])],
  };
}
/** Device-local visibility, isolated by account and drawing. */
export function useDrawingLayerVisibility(
  account: string | undefined,
  sheet: string,
  initial?: DrawingLayers,
) {
  const [saved, setSaved] = usePreference(
    account ? JSON.stringify([account, sheet]) : undefined,
  );
  const layers = useMemo<DrawingLayers>(() => migrateLayers(saved
    ? (JSON.parse(saved) as DrawingLayers)
    : (initial ?? defaults)), [saved, initial]);
  const setLayers = useCallback(
    (next: DrawingLayers | ((old: DrawingLayers) => DrawingLayers)) => {
      setSaved((old) =>
        JSON.stringify({
          ...(typeof next === "function"
            ? next(migrateLayers(old ? JSON.parse(old) as DrawingLayers : (initial ?? defaults)))
            : next),
          hyperlinkVisibilityVersion: 1,
        }),
      );
    },
    [setSaved, initial],
  );
  return [layers, setLayers] as const;
}
