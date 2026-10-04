"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Check,
  Loader2,
  PartyPopper,
  Sparkles,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  getTutorialGuide,
  placeTutorialCard,
  type GuideRect,
  type TutorialGuide,
  type TutorialPhase,
} from "./tutorial-guide";
import styles from "./TutorialExperience.module.css";
import { TUTORIAL_CHAPTERS } from "./tutorial-chapters";

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
  const rect = layout.rect;
  const below = !rect || placement.top >= rect.top + rect.height;
  const chapterIndex = TUTORIAL_CHAPTERS.findIndex(
    (chapter) => chapter.phase === phase,
  );
  const chapter = TUTORIAL_CHAPTERS[chapterIndex];
  const done = phase === "done";
  const ChapterIcon = done ? PartyPopper : (chapter?.icon ?? Sparkles);
  // Point the card's caret at the middle of the highlighted control.
  const caretLeft = rect
    ? Math.min(
        placement.width - 22,
        Math.max(22, rect.left + rect.width / 2 - placement.left),
      )
    : null;
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
            left: rect.left - offset.left - 6,
            top: rect.top - offset.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      {done && <Confetti />}
      <aside
        ref={card}
        aria-label="Tutorial guidance"
        className={`${styles.card} bg-card text-card-foreground pointer-events-auto absolute rounded-2xl shadow-2xl ring-1 ring-black/5`}
        style={{
          left: placement.left - offset.left,
          top: placement.top - offset.top,
          width: placement.width,
          maxHeight: Math.max(120, layout.bounds.height - 24),
        }}
      >
        {rect && caretLeft !== null && !layout.compact && (
          <span
            aria-hidden="true"
            className={`bg-card absolute size-4 rotate-45 ring-1 ring-black/5 ${
              below ? "-top-2" : "-bottom-2"
            }`}
            style={{ left: caretLeft - 8 }}
          />
        )}
        <div className="relative max-h-[inherit] overflow-y-auto rounded-2xl p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-semibold">
              <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full">
                <ChapterIcon aria-hidden="true" className="size-4" />
              </span>
              <span className="text-primary truncate">
                {done
                  ? "Tour complete"
                  : `${chapter?.label ?? "Tour"} · ${chapterIndex + 1} of ${TUTORIAL_CHAPTERS.length}`}
              </span>
            </div>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground min-h-8 shrink-0 rounded-md px-2 text-xs font-medium transition-colors"
              onClick={() => onFinish("skipped")}
            >
              End tutorial
            </button>
          </div>
          <div
            aria-hidden="true"
            className="mt-3 grid grid-cols-3 gap-1.5"
          >
            {TUTORIAL_CHAPTERS.map((item, index) => (
              <span
                key={item.phase}
                className="bg-muted h-1.5 overflow-hidden rounded-full"
              >
                <span
                  className={`bg-primary block h-full rounded-full transition-[width] duration-500 ease-out ${
                    done || index < chapterIndex
                      ? "w-full"
                      : index === chapterIndex
                        ? "w-1/2"
                        : "w-0"
                  }`}
                />
              </span>
            ))}
          </div>
          <div
            key={layout.guide.title}
            aria-live="polite"
            aria-atomic="true"
            className={layout.compact ? "sr-only" : `${styles.step} mt-3`}
          >
            <p className="text-base leading-snug font-semibold">
              {layout.guide.title}
            </p>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
              {layout.guide.text}
            </p>
            {done && (
              <ul className="mt-3 space-y-1.5">
                {TUTORIAL_CHAPTERS.map((item) => (
                  <li key={item.phase} className="flex items-center gap-2 text-sm">
                    <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check aria-hidden="true" className="size-3.5" />
                    </span>
                    {item.done}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!rect && (
            <p
              role="status"
              className="text-muted-foreground mt-3 flex items-center gap-2 text-xs"
            >
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
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
              size="lg"
              className="mt-4 h-11 w-full text-base"
              onClick={() =>
                layout.guide.next === "finish"
                  ? onFinish("completed")
                  : setPhase("chat")
              }
            >
              {layout.guide.next === "finish" ? "Finish tutorial" : "Next: Chat"}
              <ArrowRight aria-hidden="true" className="ml-1 size-4" />
            </Button>
          )}
        </div>
      </aside>
    </div>,
    layout.host,
  );
}

/** A short burst of confetti for the finish card. Decorative only. */
function Confetti() {
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6"];
  return (
    <div aria-hidden="true" className={styles.confetti}>
      {Array.from({ length: 36 }, (_, index) => (
        <span
          key={index}
          style={{
            left: `${(index * 37) % 100}%`,
            background: colors[index % colors.length],
            animationDelay: `${(index % 9) * 60}ms`,
            animationDuration: `${1600 + ((index * 53) % 900)}ms`,
            ["--drift" as string]: `${((index * 29) % 120) - 60}px`,
            ["--spin" as string]: `${360 + ((index * 47) % 540)}deg`,
          }}
        />
      ))}
    </div>
  );
}
