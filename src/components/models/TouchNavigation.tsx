"use client";
import { useEffect, useState } from "react";
import {
  thumbActions,
  type NavigationSettings,
} from "~/lib/bim/navigation-settings";
import type { ModelScene, TouchJoystick } from "~/lib/bim/scene";

/** Visuals only: input is captured on the canvas, never by a fixed hit target. */
export function TouchNavigation({
  settings,
  scene,
}: {
  settings: NavigationSettings["touch"];
  scene: ModelScene | null;
  walking?: boolean;
}) {
  const [sticks, setSticks] = useState<TouchJoystick[]>([]);
  useEffect(() => {
    return scene?.subscribeTouchJoysticks(setSticks);
  }, [scene]);
  if (!scene || settings.display === "off" || !settings.showJoysticks) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      {sticks
        .filter((stick) => settings[stick.side] !== "none")
        .map((stick) => (
          <div
            key={stick.side}
            data-testid={`joystick-${stick.side}`}
            className="absolute"
            style={{ left: stick.x, top: stick.y }}
          >
            <div
              className="absolute rounded-full border-2 border-white/50 bg-slate-950/40 shadow-lg"
              style={{
                width: settings.size,
                height: settings.size,
                transform: "translate(-50%, -50%)",
              }}
            >
              <span className="absolute inset-3 rounded-full border border-white/20" />
              <span
                className="absolute top-1/2 left-1/2 h-2/5 w-2/5 rounded-full border border-white/70 bg-sky-300/80 shadow"
                style={{
                  transform: `translate(calc(-50% + ${stick.dx * settings.size * 0.27}px), calc(-50% + ${stick.dy * settings.size * 0.27}px))`,
                }}
              />
            </div>
            <span
              className="absolute w-36 rounded bg-slate-950/80 px-2 py-1 text-center text-[10px] text-white"
              style={{
                transform: `translate(-50%, ${settings.size / 2 + 4}px)`,
              }}
            >
              {thumbActions[settings[stick.side]]}
            </span>
          </div>
        ))}
    </div>
  );
}
