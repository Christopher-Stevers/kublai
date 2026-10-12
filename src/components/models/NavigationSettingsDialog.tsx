"use client";
import { useEffect, useState } from "react";
import { Check, Keyboard, Mouse, RotateCcw, Settings2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import {
  DEFAULT_NAVIGATION,
  bindingConflict,
  isNavigationKey,
  keyLabel,
  mouseActions,
  mouseBindings,
  navigationActions,
  navigationKey,
  navigationPreset,
  navigationPresets,
  type NavigationAction,
  type NavigationSettings,
  type MouseBinding,
  type MouseAction,
} from "~/lib/bim/navigation-settings";

export function NavigationSettingsDialog({
  settings,
  persistent,
  onChange,
  onClose,
}: {
  settings: NavigationSettings;
  persistent: boolean;
  onChange: (settings: NavigationSettings) => boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"presets" | "keyboard" | "mouse">("presets");
  const [capture, setCapture] = useState<{
    action: NavigationAction;
    slot: 0 | 1;
  } | null>(null);
  const [error, setError] = useState("");
  const change = (next: NavigationSettings) => {
    onChange(next);
    setError("");
  };
  useEffect(() => {
    if (!capture) return;
    const record = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        setCapture(null);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setCapture(null);
        setError("");
        return;
      }
      if (event.repeat) return;
      const clear = event.key === "Backspace" || event.key === "Delete";
      const code = navigationKey(event);
      if (
        !clear &&
        (event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          event.isComposing ||
          !isNavigationKey(code))
      ) {
        setError(
          "Choose a letter, number, arrow, Space, Shift, or navigation key. Browser shortcuts are reserved.",
        );
        return;
      }
      const conflict = clear
        ? undefined
        : bindingConflict(settings, capture.action, capture.slot, code);
      if (conflict) {
        setError(
          `${keyLabel(code)} is already assigned to ${navigationActions[conflict].toLowerCase()}. Clear that binding first or choose another key.`,
        );
        return;
      }
      const keys = {
        ...settings.keys,
        [capture.action]: [...settings.keys[capture.action]] as [
          string | null,
          string | null,
        ],
      };
      keys[capture.action][capture.slot] = clear ? null : code;
      onChange({ ...settings, keys });
      setCapture(null);
      setError("");
    };
    window.addEventListener("keydown", record, true);
    return () => window.removeEventListener("keydown", record, true);
  }, [capture, settings, onChange]);
  const activePreset = navigationPresets.find(
    (p) => JSON.stringify(navigationPreset(p.id)) === JSON.stringify(settings),
  );
  const range = (
    key:
      | "moveSpeed"
      | "boostMultiplier"
      | "slowMultiplier"
      | "lookSensitivity"
      | "panSensitivity"
      | "zoomSensitivity",
    label: string,
    min: number,
    max: number,
    step: number,
    unit: string,
  ) => (
    <label className="block space-y-2" key={key}>
      <span className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <output className="text-muted-foreground tabular-nums">
          {Number(settings[key].toFixed(2))}
          {unit}
        </output>
      </span>
      <input
        aria-label={label}
        className="accent-primary h-8 w-full cursor-pointer"
        type="range"
        min={min}
        max={max}
        step={step}
        value={settings[key]}
        onChange={(e) => change({ ...settings, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onEscapeKeyDown={(e) => {
          if (capture) e.preventDefault();
        }}
      >
        <DialogHeader className="p-5 pr-12 pb-3 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-5" />
            Navigation controls
          </DialogTitle>
          <DialogDescription>
            Customize how you move through the model. Changes apply immediately.
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex gap-1 border-b px-5 pb-3"
          aria-label="Control settings sections"
        >
          {(
            [
              ["presets", Settings2, "Presets"],
              ["keyboard", Keyboard, "Keyboard"],
              ["mouse", Mouse, "Mouse"],
            ] as const
          ).map(([id, Icon, label]) => (
            <Button
              key={id}
              variant={tab === id ? "default" : "ghost"}
              size="sm"
              aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
                setCapture(null);
                setError("");
              }}
              className="min-h-10 flex-1 gap-2"
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
          {tab === "presets" && (
            <>
              <p className="text-muted-foreground text-sm">
                Current configuration:{" "}
                <strong className="text-foreground font-medium">
                  {activePreset?.name ?? "Custom"}
                </strong>
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {navigationPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={activePreset?.id === preset.id}
                    onClick={() => change(navigationPreset(preset.id))}
                    className={cn(
                      "hover:bg-muted min-h-24 rounded-lg border p-3 text-left",
                      activePreset?.id === preset.id &&
                        "border-primary bg-primary/10",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 font-medium">
                      {preset.name}
                      {activePreset?.id === preset.id && (
                        <Check className="text-primary size-4" />
                      )}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
                      {preset.description}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                Choosing a preset replaces your current controls. Fine-tune any
                preset in Keyboard and Mouse.
              </p>
              <div className="space-y-3 border-t pt-4">
                <label className="block space-y-2 text-sm">
                  Movement direction
                  <select
                    aria-label="Movement direction"
                    className="bg-background min-h-11 w-full rounded-md border px-3"
                    value={settings.movement}
                    onChange={(e) =>
                      change({
                        ...settings,
                        movement: e.target.value as "fly" | "ground",
                      })
                    }
                  >
                    <option value="fly">
                      Fly in the direction you’re looking
                    </option>
                    <option value="ground">
                      Keep forward/back movement horizontal
                    </option>
                  </select>
                </label>
                <p className="text-muted-foreground text-xs">
                  Up/down controls change elevation in either mode. Movement has
                  no collision detection.
                </p>
                {range("moveSpeed", "Movement speed", 0.1, 25, 0.1, " m/s")}
                {range(
                  "boostMultiplier",
                  "Fast speed multiplier",
                  1,
                  10,
                  0.1,
                  "×",
                )}
                {range(
                  "slowMultiplier",
                  "Precision speed multiplier",
                  0.05,
                  1,
                  0.05,
                  "×",
                )}
              </div>
            </>
          )}
          {tab === "keyboard" && (
            <>
              <p className="text-muted-foreground text-sm">
                Click a binding, then press a key. Backspace clears it; Escape
                cancels. Shortcuts work when the model has focus.
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_7rem_7rem]">
                <span className="text-muted-foreground">Action</span>
                <span className="text-muted-foreground text-center">
                  Primary
                </span>
                <span className="text-muted-foreground text-center">
                  Alternate
                </span>
                {(Object.keys(navigationActions) as NavigationAction[]).map(
                  (action) => (
                    <div
                      key={action}
                      className="col-span-3 grid grid-cols-subgrid items-center gap-2 border-b py-2 last:border-0"
                    >
                      <span className="text-sm">
                        {navigationActions[action]}
                      </span>
                      {([0, 1] as const).map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          aria-label={`Rebind ${navigationActions[action]} ${slot === 0 ? "primary" : "alternate"}`}
                          aria-pressed={
                            capture?.action === action && capture.slot === slot
                          }
                          className={cn(
                            "hover:bg-muted min-h-11 rounded-md border px-1 text-center font-mono text-xs",
                            capture?.action === action &&
                              capture.slot === slot &&
                              "border-primary bg-primary/15 text-primary",
                          )}
                          onClick={() => {
                            setCapture({ action, slot });
                            setError("");
                          }}
                        >
                          {capture?.action === action && capture.slot === slot
                            ? "Press key…"
                            : keyLabel(settings.keys[action][slot])}
                        </button>
                      ))}
                    </div>
                  ),
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Escape always cancels the current selection or measurement. Tab
                and browser shortcuts remain available. On-screen movement
                buttons keep their direction regardless of key bindings.
              </p>
            </>
          )}
          {tab === "mouse" && (
            <>
              <p className="text-muted-foreground text-sm">
                Choose what dragging each button does. A left click still
                selects or places a measurement point. Shift gives each button a
                second action.
              </p>
              <div className="space-y-2">
                {(Object.keys(mouseBindings) as MouseBinding[]).map((key) => (
                  <label
                    key={key}
                    className="grid grid-cols-2 items-center gap-3 text-sm"
                  >
                    <span>{mouseBindings[key]}</span>
                    <select
                      aria-label={mouseBindings[key]}
                      className="bg-background min-h-11 min-w-0 rounded-md border px-2"
                      value={settings.mouse[key]}
                      onChange={(e) =>
                        change({
                          ...settings,
                          mouse: {
                            ...settings.mouse,
                            [key]: e.target.value as MouseAction,
                          },
                        })
                      }
                    >
                      {(Object.keys(mouseActions) as MouseAction[]).map(
                        (action) => (
                          <option key={action} value={action}>
                            {mouseActions[action]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                ))}
              </div>
              <div className="space-y-3 border-t pt-4">
                {range(
                  "lookSensitivity",
                  "Look / orbit sensitivity",
                  0.1,
                  4,
                  0.1,
                  "×",
                )}
                {range("panSensitivity", "Pan sensitivity", 0.1, 4, 0.1, "×")}
                {range("zoomSensitivity", "Zoom sensitivity", 0.1, 4, 0.1, "×")}
                {(
                  [
                    ["invertY", "Invert vertical look / orbit"],
                    ["invertX", "Invert horizontal look / orbit"],
                    ["reverseScroll", "Reverse scroll zoom"],
                    ["reversePan", "Reverse mouse pan"],
                    ["smoothing", "Smooth touch navigation"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex min-h-11 items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="accent-primary size-4"
                      checked={settings[key]}
                      onChange={(e) =>
                        change({ ...settings, [key]: e.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">
                Touch: pinch to zoom and use two fingers to pan. One finger
                orbits the model; in Walk it looks around. Direction inversion
                applies to mouse dragging and Walk look.
              </p>
            </>
          )}
        </div>
        <div className="bg-background space-y-3 border-t p-4">
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <p role="status" className="text-muted-foreground text-xs">
            {capture
              ? `Press a key for ${navigationActions[capture.action].toLowerCase()}.`
              : persistent
                ? "Saved automatically for this account on this device."
                : "Browser storage is unavailable. Changes apply for this session."}
          </p>
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setCapture(null);
                change(structuredClone(DEFAULT_NAVIGATION));
              }}
              className="gap-2"
            >
              <RotateCcw className="size-4" />
              Reset defaults
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
