import { z } from "zod";

export const navigationActions = {
  forward: "Move forward",
  backward: "Move backward",
  left: "Move left",
  right: "Move right",
  up: "Move up",
  down: "Move down",
  boost: "Move faster (hold)",
  slow: "Precision speed (hold)",
  fit: "Fit entire model",
  focus: "Focus selected element",
  iso: "Isometric view",
  top: "Top view",
  front: "Front view",
  rightView: "Right view",
} as const;
export type NavigationAction = keyof typeof navigationActions;
const actions = Object.keys(navigationActions) as NavigationAction[];
export const mouseActions = {
  look: "Look around",
  orbit: "Orbit model",
  pan: "Pan",
  zoom: "Zoom",
  none: "No drag action",
} as const;
export type MouseAction = keyof typeof mouseActions;
export const mouseBindings = {
  left: "Left button",
  middle: "Middle button",
  right: "Right button",
  shiftLeft: "Shift + left button",
  shiftMiddle: "Shift + middle button",
  shiftRight: "Shift + right button",
} as const;
export type MouseBinding = keyof typeof mouseBindings;
export function isNavigationKey(code: string) {
  return /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|PageUp|PageDown|Home|End|Space|Shift|Minus|Equal|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|Backquote)$/.test(
    code,
  );
}
export const thumbActions = {
  look: "Steer / look around",
  fly: "Fly forward / backward",
  move: "Forward / backward + strafe",
  elevation: "Up / down + strafe",
  orbit: "Orbit model",
  pan: "Pan across view",
  zoom: "Zoom in / out",
  none: "Disabled",
} as const;
export type ThumbAction = keyof typeof thumbActions;
export type ThumbSide = "left" | "right";
const defaultTouch = {
  display: "auto" as const,
  left: "look" as ThumbAction,
  right: "fly" as ThumbAction,
  sensitivity: 1,
  size: 112,
  invertY: false,
  showJoysticks: true,
};
const touchSchema = z.object({
  showJoysticks: z.boolean().default(true),
  display: z.enum(["auto", "always", "off"]),
  left: z.enum(Object.keys(thumbActions) as ThumbAction[]),
  right: z.enum(Object.keys(thumbActions) as ThumbAction[]),
  sensitivity: z.number().min(0.25).max(3),
  size: z.number().min(80).max(144),
  invertY: z.boolean(),
});
export const touchPresets = [
  { name: "Steer & fly", left: "look", right: "fly" },
  { name: "Game controller", left: "move", right: "look" },
  { name: "Left-handed flight", left: "fly", right: "look" },
  { name: "Orbit & pan", left: "pan", right: "orbit" },
  { name: "Orbit & zoom", left: "orbit", right: "zoom" },
  { name: "Elevation & steering", left: "elevation", right: "look" },
] as const;
const binding = z.string().refine(isNavigationKey).nullable();
export const navigationSettingsSchema = z.object({
  version: z.literal(1),
  touch: touchSchema.default(defaultTouch),
  keys: z.record(z.enum(actions), z.tuple([binding, binding])),
  mouse: z.record(
    z.enum(Object.keys(mouseBindings) as MouseBinding[]),
    z.enum(Object.keys(mouseActions) as MouseAction[]),
  ),
  movement: z.enum(["fly", "ground"]),
  moveSpeed: z.number().min(0.1).max(25),
  boostMultiplier: z.number().min(1).max(10),
  slowMultiplier: z.number().min(0.05).max(1),
  lookSensitivity: z.number().min(0.1).max(4),
  panSensitivity: z.number().min(0.1).max(4),
  zoomSensitivity: z.number().min(0.1).max(4),
  invertX: z.boolean(),
  invertY: z.boolean(),
  reverseScroll: z.boolean(),
  reversePan: z.boolean(),
  smoothing: z.boolean(),
});
export type NavigationSettings = z.infer<typeof navigationSettingsSchema>;
export const DEFAULT_NAVIGATION: NavigationSettings = {
  version: 1,
  touch: { ...defaultTouch },
  keys: {
    forward: ["KeyW", "ArrowUp"],
    backward: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    up: ["KeyE", "PageUp"],
    down: ["KeyQ", "PageDown"],
    boost: ["Shift", null],
    slow: ["KeyC", null],
    fit: ["KeyF", null],
    focus: ["KeyG", null],
    iso: ["Digit0", "Numpad0"],
    top: ["Digit7", "Numpad7"],
    front: ["Digit1", "Numpad1"],
    rightView: ["Digit3", "Numpad3"],
  },
  mouse: {
    left: "look",
    middle: "pan",
    right: "pan",
    shiftLeft: "orbit",
    shiftMiddle: "pan",
    shiftRight: "look",
  },
  movement: "fly",
  moveSpeed: 2.5,
  boostMultiplier: 3.2,
  slowMultiplier: 0.25,
  lookSensitivity: 1,
  panSensitivity: 1,
  zoomSensitivity: 1,
  invertX: false,
  invertY: false,
  reverseScroll: false,
  reversePan: false,
  smoothing: true,
};
export const navigationPresets = [
  {
    id: "first-person",
    name: "First person",
    description: "WASD travel · left-drag look · middle-drag pan",
  },
  {
    id: "cad",
    name: "Orbit / CAD",
    description: "Left-drag orbit · middle-drag pan · right-drag look",
  },
  {
    id: "trackpad",
    name: "Trackpad",
    description: "Left-drag orbit · Shift-drag pan · scroll to zoom",
  },
  {
    id: "left-handed",
    name: "Left-handed",
    description: "IJKL travel · right-drag look · middle-drag pan",
  },
] as const;
export type NavigationPreset = (typeof navigationPresets)[number]["id"];
export function navigationPreset(id: NavigationPreset): NavigationSettings {
  const result = structuredClone(DEFAULT_NAVIGATION);
  if (id === "cad" || id === "trackpad") {
    result.mouse = {
      left: "orbit",
      middle: "pan",
      right: "look",
      shiftLeft: "pan",
      shiftMiddle: "orbit",
      shiftRight: "zoom",
    };
    result.movement = "ground";
  }
  if (id === "left-handed") {
    result.keys.forward[0] = "KeyI";
    result.keys.backward[0] = "KeyK";
    result.keys.left[0] = "KeyJ";
    result.keys.right[0] = "KeyL";
    result.keys.up[0] = "KeyO";
    result.keys.down[0] = "KeyU";
    result.mouse.left = "orbit";
    result.mouse.right = "look";
    result.mouse.shiftLeft = "pan";
  }
  if (id === "trackpad") {
    result.lookSensitivity = 0.75;
    result.zoomSensitivity = 0.6;
    result.smoothing = false;
  }
  return result;
}
export function navigationKey(
  event: Pick<KeyboardEvent, "code" | "key">,
): string {
  if (event.key === "Shift" || event.code.startsWith("Shift")) return "Shift";
  if (event.code) return event.code;
  if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`;
  if (/^[0-9]$/.test(event.key)) return `Digit${event.key}`;
  return event.key === " " ? "Space" : event.key;
}
export function keyLabel(code: string | null): string {
  if (!code) return "Unbound";
  const labels: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    PageUp: "Page Up",
    PageDown: "Page Down",
    Space: "Space",
    Minus: "−",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backquote: "`",
  };
  return (
    labels[code] ?? code.replace(/^Key|^Digit/, "").replace(/^Numpad/, "Num ")
  );
}
export function bindingConflict(
  settings: NavigationSettings,
  action: NavigationAction,
  slot: number,
  code: string,
) {
  return actions.find((a) =>
    settings.keys[a].some(
      (key, index) => key === code && !(a === action && index === slot),
    ),
  );
}
export function boundActions(
  settings: NavigationSettings,
  pressed: ReadonlySet<string>,
): Set<NavigationAction> {
  return new Set(
    actions.filter((action) =>
      settings.keys[action].some((code) => code !== null && pressed.has(code)),
    ),
  );
}
export function mouseAction(
  settings: NavigationSettings,
  button: number,
  shift: boolean,
): MouseAction {
  const key = (
    shift
      ? ["shiftLeft", "shiftMiddle", "shiftRight"]
      : ["left", "middle", "right"]
  )[button] as MouseBinding | undefined;
  return key ? settings.mouse[key] : "none";
}
