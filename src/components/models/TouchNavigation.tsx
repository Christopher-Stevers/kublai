"use client";
import { useEffect, useRef, useState } from "react";
import {
  thumbActions,
  type NavigationSettings,
  type ThumbSide,
} from "~/lib/bim/navigation-settings";
import type { ModelScene } from "~/lib/bim/scene";
import { cn } from "~/lib/utils";

export function thumbPosition(x: number, y: number, radius: number) {
  const length = Math.hypot(x, y) / radius;
  if (length <= 0.12) return { x: 0, y: 0 };
  const magnitude = Math.min(1, (length - 0.12) / 0.88);
  const direction = Math.hypot(x, y);
  return { x: (x / direction) * magnitude, y: (y / direction) * magnitude };
}

function ThumbPad({
  side,
  settings,
  scene,
}: {
  side: ThumbSide;
  settings: NavigationSettings["touch"];
  scene: ModelScene | null;
}) {
  const pointer = useRef<number | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const stop = () => {
    pointer.current = null;
    setPosition({ x: 0, y: 0 });
    scene?.setThumb(side, 0, 0);
  };
  useEffect(() => {
    const reset = () => {
      pointer.current = null;
      setPosition({ x: 0, y: 0 });
      scene?.setThumb(side, 0, 0);
    };
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    reset();
    return () => {
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      scene?.setThumb(side, 0, 0);
    };
  }, [scene, side, settings]);
  if (settings[side] === "none") return <div />;
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = thumbPosition(
      event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2,
      rect.width * 0.36,
    );
    setPosition(next);
    scene?.setThumb(side, next.x, next.y);
  };
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div
        role="group"
        aria-label={`${side === "left" ? "Left" : "Right"} thumb: ${thumbActions[settings[side]]}`}
        className="pointer-events-auto relative touch-none rounded-full border-2 border-white/50 bg-slate-950/60 shadow-lg select-none"
        style={{
          width: settings.size,
          height: settings.size,
          maxWidth: "34vw",
          maxHeight: "34vw",
        }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(event) => {
          if (pointer.current !== null || event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event);
        }}
        onPointerMove={(event) => {
          if (pointer.current === event.pointerId) {
            event.preventDefault();
            move(event);
          }
        }}
        onPointerUp={(event) => {
          if (pointer.current === event.pointerId) stop();
        }}
        onPointerCancel={(event) => {
          if (pointer.current === event.pointerId) stop();
        }}
        onLostPointerCapture={(event) => {
          if (pointer.current === event.pointerId) stop();
        }}
      >
        <span
          aria-hidden
          className="absolute inset-3 rounded-full border border-white/20"
        />
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 h-2/5 w-2/5 rounded-full border border-white/70 bg-sky-300/80 shadow"
          style={{
            transform: `translate(calc(-50% + ${position.x * settings.size * 0.27}px), calc(-50% + ${position.y * settings.size * 0.27}px))`,
          }}
        />
      </div>
      <span className="max-w-36 rounded bg-slate-950/80 px-2 py-1 text-center text-[10px] leading-tight text-white">
        {thumbActions[settings[side]]}
      </span>
    </div>
  );
}

export function TouchNavigation({
  settings,
  scene,
  walking,
}: {
  settings: NavigationSettings["touch"];
  scene: ModelScene | null;
  walking: boolean;
}) {
  if (settings.display === "off") return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-3 bottom-36 left-3 z-10 justify-between gap-4",
        settings.display === "always" || walking
          ? "flex"
          : "hidden [@media(pointer:coarse)]:flex",
      )}
    >
      <ThumbPad side="left" settings={settings} scene={scene} />
      <ThumbPad side="right" settings={settings} scene={scene} />
    </div>
  );
}
