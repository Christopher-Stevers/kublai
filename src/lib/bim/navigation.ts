import { type Quaternion, Vector3 } from "three";
import {
  DEFAULT_NAVIGATION,
  type NavigationAction,
  type NavigationSettings,
} from "./navigation-settings";

/** Translate in camera space so looking up/down also steers forward travel. */
export function navigationDelta(
  orientation: Quaternion,
  keys: ReadonlySet<NavigationAction>,
  seconds: number,
  settings: NavigationSettings = DEFAULT_NAVIGATION,
): Vector3 {
  const forward = Number(keys.has("forward")) - Number(keys.has("backward"));
  const sideways = Number(keys.has("right")) - Number(keys.has("left"));
  const right = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const facing = new Vector3(0, 0, -1).applyQuaternion(orientation);
  if (settings.movement === "ground") {
    right.y = 0;
    right.normalize();
    facing.crossVectors(new Vector3(0, 1, 0), right);
  }
  const delta = right.multiplyScalar(sideways).addScaledVector(facing, forward);
  delta.y += Number(keys.has("up")) - Number(keys.has("down"));
  // Diagonal movement should be the same speed as a single direction.
  return delta
    .normalize()
    .multiplyScalar(
      Math.min(0.05, Math.max(0, seconds)) *
        settings.moveSpeed *
        (keys.has("slow")
          ? settings.slowMultiplier
          : keys.has("boost")
            ? settings.boostMultiplier
            : 1),
    );
}
