import { type Quaternion, Vector3 } from "three";

/** Translate in camera space so looking up/down also steers forward travel. */
export function navigationDelta(
  orientation: Quaternion,
  keys: ReadonlySet<string>,
  seconds: number,
): Vector3 {
  const forward =
    Number(keys.has("w") || keys.has("arrowup")) -
    Number(keys.has("s") || keys.has("arrowdown"));
  const sideways =
    Number(keys.has("d") || keys.has("arrowright")) -
    Number(keys.has("a") || keys.has("arrowleft"));
  const delta = new Vector3(sideways, 0, -forward).applyQuaternion(orientation);
  delta.y += Number(keys.has("e")) - Number(keys.has("q"));
  // Diagonal movement should be the same speed as a single direction.
  return delta
    .normalize()
    .multiplyScalar(
      Math.min(0.05, Math.max(0, seconds)) * (keys.has("shift") ? 8 : 2.5),
    );
}
