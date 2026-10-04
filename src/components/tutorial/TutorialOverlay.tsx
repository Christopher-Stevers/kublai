"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  getTutorialGuide,
  placeTutorialCard,
  type GuideRect,
  type TutorialGuide,
  type TutorialPhase,
} from "./tutorial-guide";
import styles from "./TutorialExperience.module.css";

type Layout = {
  guide: TutorialGuide;
  target: HTMLElement | null;
  allowed: HTMLElement[];
  rect: GuideRect | null;
  bounds: GuideRect;
  host: HTMLElement;
  hostRect: GuideRect | null;
  compact: boolean;
};
const focusables =
  'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]';
function visible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    !element.closest('[hidden],[aria-hidden="true"]')
  );
}
function rectOf(element: HTMLElement): GuideRect {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

export function TutorialOverlay({
  onFinish,
  error,
}: {
  onFinish: (outcome: "completed" | "skipped") => void;
  error?: string | null;
}) {
  const [phase, setPhase] = useState<TutorialPhase>("materials");
  const [layout, setLayout] = useState<Layout | null>(null);
  const card = useRef<HTMLElement>(null);
  const lastTarget = useRef<HTMLElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const [cardHeight, setCardHeight] = useState(210);
  useEffect(() => {
    let frame = 0;
    const find = (name: string) => {
      const root =
        Array.from(
          document.querySelectorAll<HTMLElement>(`[data-tutorial="${name}"]`),
        ).find(visible) ?? null;
      const choices: Record<string, string[]> = {
        "wizard-catalog": ["Plumbing"],
        "wizard-material": ["PVC", "XFR"],
        "wizard-size": ["2 in"],
        "wizard-category": ["Fittings"],
        "wizard-part": ['2" XFR 90'],
      };
      const names = choices[name];
      if (!root || !names || root.matches('button,[role="button"]'))
        return root;
      // Highlight the actual choice, not the whole picker or its Create controls.
      const options = Array.from(
        root.querySelectorAll<HTMLElement>("[data-tutorial-choice]"),
      ).filter(visible);
      return (
        names
          .map((label) =>
            options.find((option) => option.dataset.tutorialChoice === label),
          )
          .find(Boolean) ?? null
      );
    };
    const refresh = () => {
      frame = 0;
      if (phase === "materials" && find("material-items")) {
        setPhase("rooms");
        return;
      }
      if (phase === "chat" && find("chat-own-message")) {
        setPhase("done");
        return;
      }
      const guide = getTutorialGuide(phase, find);
      const target = find(guide.target);
      const dialog = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-slot="dialog-content"][data-state="open"]',
        ),
      )
        .filter(visible)
        .at(-1);
      const host = dialog ?? document.body;
      const hostRect = dialog ? rectOf(dialog) : null;
      const viewport = window.visualViewport;
      const viewportRect = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
      };
      const bounds = hostRect
        ? {
            left: Math.max(hostRect.left, viewportRect.left),
            top: Math.max(hostRect.top, viewportRect.top),
            width:
              Math.min(
                hostRect.left + hostRect.width,
                viewportRect.left + viewportRect.width,
              ) - Math.max(hostRect.left, viewportRect.left),
            height:
              Math.min(
                hostRect.top + hostRect.height,
                viewportRect.top + viewportRect.height,
              ) - Math.max(hostRect.top, viewportRect.top),
          }
        : viewportRect;
      const allowed = [target, ...(guide.allow ?? []).map(find)].filter(
        (value): value is HTMLElement => !!value,
      );
      const next = {
        guide,
        target,
        allowed,
        rect: target ? rectOf(target) : null,
        bounds,
        host,
        hostRect,
        compact:
          document.activeElement instanceof HTMLElement &&
          document.activeElement.matches("input,textarea") &&
          allowed.some((element) => element.contains(document.activeElement)) &&
          (bounds.height < 500 ||
            viewportRect.height < window.innerHeight - 100),
      };
      layoutRef.current = next;
      setLayout((old) =>
        old?.target === next.target &&
        old.host === next.host &&
        old.compact === next.compact &&
        JSON.stringify([old.guide, old.rect, old.bounds, old.hostRect]) ===
          JSON.stringify([next.guide, next.rect, next.bounds, next.hostRect])
          ? old
          : next,
      );
      if (target && lastTarget.current !== target) {
        lastTarget.current = target;
        target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        schedule();
      }
      if (card.current) {
        const height = card.current.getBoundingClientRect().height;
        if (height > 0) setCardHeight(height);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(refresh);
    };
    const observer = new MutationObserver((changes) => {
      if (
        changes.some(
          (change) =>
            !(
              change.target instanceof Element &&
              change.target.closest("[data-tutorial-overlay]")
            ),
        )
      )
        schedule();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-tutorial-stage",
        "data-tutorial-pending-count",
        "data-state",
        "data-tutorial-notes-saved",
      ],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.documentElement);
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("input", schedule, true);
    document.addEventListener("focusin", schedule, true);
    document.addEventListener("focusout", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    refresh();
    return () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("input", schedule, true);
      document.removeEventListener("focusin", schedule, true);
      document.removeEventListener("focusout", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [phase]);

  useEffect(() => {
    const allowed = (node: EventTarget | null) =>
      node instanceof Element &&
      (!!node.closest("[data-tutorial-overlay]") ||
        layoutRef.current?.allowed.some((element) => element.contains(node)));
    const guard = (event: Event) => {
      if (!allowed(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const contextMenu = (event: Event) => {
      if (
        allowed(event.target) &&
        event.target instanceof Element &&
        event.target.closest("input,textarea")
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const elements = [
          ...(layoutRef.current?.allowed.flatMap((element) => [
            element,
            ...Array.from(element.querySelectorAll<HTMLElement>(focusables)),
          ]) ?? []),
          ...Array.from(
            card.current?.querySelectorAll<HTMLElement>(focusables) ?? [],
          ),
        ].filter((element) => element.matches(focusables) && visible(element));
        const unique = [...new Set(elements)];
        if (!unique.length) return;
        event.preventDefault();
        const index = unique.indexOf(document.activeElement as HTMLElement);
        const next =
          index < 0
            ? event.shiftKey
              ? unique.length - 1
              : 0
            : (index + (event.shiftKey ? -1 : 1) + unique.length) %
              unique.length;
        unique[next]?.focus();
      } else if (
        (event.key === "Enter" || event.key === " ") &&
        !allowed(event.target)
      )
        guard(event);
    };
    document.addEventListener("pointerdown", guard, true);
    document.addEventListener("pointerup", guard, true);
    document.addEventListener("click", guard, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("contextmenu", contextMenu, true);
    return () => {
      document.removeEventListener("pointerdown", guard, true);
      document.removeEventListener("pointerup", guard, true);
      document.removeEventListener("click", guard, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("contextmenu", contextMenu, true);
    };
  }, []);

  if (!layout) return null;
  const offset = layout.hostRect ?? { left: 0, top: 0 };
  const placement = placeTutorialCard(layout.rect, layout.bounds, cardHeight);
  if (layout.compact) placement.top = layout.bounds.top + 4;
  const below =
    !layout.rect || placement.top >= layout.rect.top + layout.rect.height;
  const rect = layout.rect;
  return createPortal(
    <div
      data-tutorial-overlay
      className="pointer-events-none z-[1000]"
      style={{ position: layout.hostRect ? "absolute" : "fixed", inset: 0 }}
    >
      {rect && (
        <div
          aria-hidden="true"
          className={styles.spotlight}
          style={{
            position: "absolute",
            left: rect.left - offset.left - 4,
            top: rect.top - offset.top - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      )}
      <aside
        ref={card}
        aria-label="Tutorial guidance"
        className="bg-card text-card-foreground pointer-events-auto absolute rounded-xl border border-blue-400 p-4 shadow-xl"
        style={{
          left: placement.left - offset.left,
          top: placement.top - offset.top,
          width: placement.width,
          maxHeight: Math.max(120, layout.bounds.height - 24),
          overflowY: "auto",
        }}
      >
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-blue-700 dark:text-blue-300">
            Tutorial ·{" "}
            {phase === "materials"
              ? "Material lists"
              : phase === "rooms"
                ? "Rooms"
                : "Chat"}
          </span>
          <button
            type="button"
            className="min-h-8 rounded px-2 underline underline-offset-2"
            onClick={() => onFinish("skipped")}
          >
            End tutorial
          </button>
        </div>
        <div
          aria-live="polite"
          aria-atomic="true"
          className={layout.compact ? "sr-only" : "mt-2"}
        >
          <p className="flex items-center gap-2 font-semibold">
            {rect &&
              (below ? (
                <ArrowUp
                  aria-hidden="true"
                  className="size-5 shrink-0 text-blue-600"
                />
              ) : (
                <ArrowDown
                  aria-hidden="true"
                  className="size-5 shrink-0 text-blue-600"
                />
              ))}
            {layout.guide.title}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {layout.guide.text}
          </p>
        </div>
        {!rect && (
          <p role="status" className="text-muted-foreground mt-2 text-xs">
            Waiting for this screen…
          </p>
        )}
        {error && (
          <p role="status" className="mt-2 text-xs">
            {error}
          </p>
        )}
        {layout.guide.next && !layout.compact && (
          <Button
            className="mt-3 w-full"
            onClick={() =>
              layout.guide.next === "finish"
                ? onFinish("completed")
                : setPhase("chat")
            }
          >
            {layout.guide.next === "finish" ? "Finish tutorial" : "Next: Chat"}
          </Button>
        )}
      </aside>
    </div>,
    layout.host,
  );
}
