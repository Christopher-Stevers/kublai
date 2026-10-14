"use client";

import { useEffect, useRef, type PointerEvent } from "react";
import { CheckIcon, MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { DrawingMarkup } from "~/lib/drawing-workspace";
import {
  drawingFontSize,
  layoutDrawingText,
} from "~/lib/drawing-annotation-geometry";
import { MEASURE_COLORS } from "~/lib/sheet-measure-color";

const MIN_FONT = 6;
const MAX_FONT = 300;
const clampFont = (size: number) =>
  Math.round(Math.min(MAX_FONT, Math.max(MIN_FONT, size)));

export type InlineTextEditing = {
  /** The saved markup being edited, or null for a new note. */
  id: string | null;
  data: DrawingMarkup;
  onChange: (data: DrawingMarkup) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete?: () => void;
};

/**
 * Types a text markup straight onto the drawing. The note keeps its sheet
 * position and size; the corner handle and the toolbar change its size and
 * colour as you go.
 */
export function InlineTextEditor({
  editing,
  x,
  y,
  pxPerUnit,
  frameWidth,
}: {
  editing: InlineTextEditing;
  /** Screen position of the first line's baseline, inside the frame. */
  x: number;
  y: number;
  /** Screen pixels per drawing unit (the sheet is 1000 units wide). */
  pxPerUnit: number;
  frameWidth: number;
}) {
  const { data, onChange, onDone, onCancel, onDelete } = editing;
  const field = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  const resize = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const fontSize = drawingFontSize(data);
  const box = data.textBox;
  // Inside a box the words wrap and, once the box is full, shrink to fit,
  // exactly as the saved note is drawn.
  const shownSize = box ? layoutDrawingText(data).fontSize : fontSize;
  const screenFont = Math.max(box ? 1 : 10, shownSize * pxPerUnit);
  const top = y - screenFont * 0.8;
  const setBox = (width: number, height: number) =>
    onChange({
      ...data,
      fontSize,
      textBox: {
        width: Math.round(Math.min(1000, Math.max(fontSize, width))),
        height: Math.round(Math.min(10000, Math.max(fontSize, height))),
      },
    });
  const setFont = (size: number) =>
    onChange({ ...data, fontSize: clampFont(size) });

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);
  // Tapping elsewhere on the drawing finishes the note.
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || root.current?.contains(target))
        return;
      if (
        target.closest("[data-drawing-chrome], [role='dialog'], [role='menu']")
      )
        return;
      done.current();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);
  // Without a box, grow with the text, line by line.
  useEffect(() => {
    const element = field.current;
    if (!element || box) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    element.style.width = "auto";
    element.style.width = `${Math.min(frameWidth - x - 8, Math.max(screenFont * 2, element.scrollWidth + 4))}px`;
  }, [data.text, screenFont, frameWidth, x, box]);

  // The drawing must not pan, select or draw under the editor.
  const stop = (event: PointerEvent) => event.stopPropagation();
  const shield = {
    onPointerDown: stop,
    onPointerMove: stop,
    onPointerUp: stop,
    onWheel: (event: { stopPropagation: () => void }) =>
      event.stopPropagation(),
  };
  return (
    <>
      {/* Docked at the bottom of the drawing, like the other markup controls. */}
      <div
        ref={bar}
        data-drawing-chrome
        className="bg-card/95 absolute inset-x-0 bottom-0 z-30 rounded-t-2xl border-t px-3 pt-2.5 pb-2 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur"
        {...shield}
      >
        <div
          role="toolbar"
          aria-label="Text style"
          className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto [scrollbar-width:none]"
        >
          <div className="bg-muted flex shrink-0 items-center rounded-full p-0.5">
            <button
              type="button"
              aria-label="Smaller text"
              className="hover:bg-accent grid size-8 place-items-center rounded-full"
              onClick={() => setFont(fontSize / 1.15)}
            >
              <MinusIcon className="size-4" />
            </button>
            <span
              className="w-8 text-center text-xs font-semibold tabular-nums"
              aria-label="Text size"
            >
              {Math.round(fontSize)}
            </span>
            <button
              type="button"
              aria-label="Larger text"
              className="hover:bg-accent grid size-8 place-items-center rounded-full"
              onClick={() => setFont(fontSize * 1.15)}
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
          <div
            role="group"
            aria-label="Text colour"
            className="flex items-center gap-1.5"
          >
            {MEASURE_COLORS.slice(0, 5).map((item) => {
              const active =
                data.stroke.slice(0, 7).toLowerCase() ===
                item.value.toLowerCase();
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-label={item.name}
                  aria-pressed={active}
                  className={`size-7 shrink-0 rounded-full border border-black/15 ${active ? "ring-primary ring-offset-card ring-2 ring-offset-1" : ""}`}
                  style={{ backgroundColor: item.value }}
                  onClick={() => onChange({ ...data, stroke: item.value })}
                />
              );
            })}
            <label
              className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-full border"
              title="Custom colour"
              style={{
                background:
                  "conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
              }}
            >
              <input
                type="color"
                aria-label="Custom text colour"
                value={data.stroke.slice(0, 7)}
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) =>
                  onChange({ ...data, stroke: event.target.value })
                }
              />
            </label>
          </div>
          <span aria-hidden className="min-w-2 flex-1" />
          {onDelete && (
            <button
              type="button"
              aria-label="Delete text"
              className="text-destructive hover:bg-destructive/10 grid size-10 shrink-0 place-items-center rounded-full"
              onClick={onDelete}
            >
              <Trash2Icon className="size-4" />
            </button>
          )}
          <button
            type="button"
            aria-label="Done editing text"
            className="bg-primary text-primary-foreground grid size-10 shrink-0 place-items-center rounded-full shadow-sm"
            onClick={onDone}
          >
            <CheckIcon className="size-4" />
          </button>
        </div>
      </div>
      <div
        ref={root}
        data-drawing-chrome
        className="absolute z-30"
        style={{ left: x, top }}
        {...shield}
      >
        <div className="relative">
          <textarea
            ref={field}
            aria-label="Text"
            rows={1}
            value={data.text ?? ""}
            placeholder="Type here"
            spellCheck
            onChange={(event) =>
              onChange({ ...data, text: event.target.value })
            }
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              } else if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey)
              ) {
                event.preventDefault();
                onDone();
              }
            }}
            className={`border-primary/70 block resize-none overflow-hidden rounded-sm border border-dashed bg-transparent p-0 outline-none placeholder:opacity-50 ${box ? "break-words whitespace-pre-wrap" : "whitespace-pre"}`}
            style={{
              ...(box
                ? {
                    width: box.width * pxPerUnit,
                    height: box.height * pxPerUnit,
                  }
                : {}),
              fontSize: screenFont,
              lineHeight: 1.25,
              color: data.stroke,
              // Matches the white halo drawn around saved text.
              textShadow:
                "0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff, 0 0 3px #fff",
              caretColor: data.stroke,
            }}
          />
          <span
            role="button"
            aria-label="Resize text box"
            tabIndex={0}
            title="Drag to resize the text box"
            className="bg-card border-primary absolute -right-3 -bottom-3 size-5 cursor-nwse-resize touch-none rounded-full border-2 shadow"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              const element = field.current;
              resize.current = {
                x: event.clientX,
                y: event.clientY,
                width: box?.width ?? (element?.offsetWidth ?? 80) / pxPerUnit,
                height:
                  box?.height ?? (element?.offsetHeight ?? 24) / pxPerUnit,
              };
            }}
            onPointerMove={(event) => {
              event.stopPropagation();
              const start = resize.current;
              if (!start) return;
              // Width and height follow the handle; text wraps to the width.
              setBox(
                start.width + (event.clientX - start.x) / pxPerUnit,
                start.height + (event.clientY - start.y) / pxPerUnit,
              );
            }}
            onPointerUp={(event) => {
              event.stopPropagation();
              resize.current = null;
            }}
            onKeyDown={(event) => {
              const element = field.current;
              const width =
                box?.width ?? (element?.offsetWidth ?? 80) / pxPerUnit;
              const height =
                box?.height ?? (element?.offsetHeight ?? 24) / pxPerUnit;
              const step = 10;
              const change: Record<string, [number, number]> = {
                ArrowRight: [step, 0],
                ArrowLeft: [-step, 0],
                ArrowDown: [0, step],
                ArrowUp: [0, -step],
              };
              const delta = change[event.key];
              if (!delta) return;
              event.preventDefault();
              setBox(width + delta[0], height + delta[1]);
            }}
          />
        </div>
      </div>
    </>
  );
}
