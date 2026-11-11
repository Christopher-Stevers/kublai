"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type PointerEvent,
} from "react";
import { EyeOff } from "lucide-react";
import type {
  CatalogueHideCriteria,
  CatalogueHideRule,
} from "~/lib/catalogue-hidden";

const Visibility = createContext<{
  scope: CatalogueHideCriteria;
  rules: CatalogueHideRule[];
  enabled: boolean;
  acrossAll?: boolean;
  hiddenPartIds?: string[];
  hide: (criteria: CatalogueHideCriteria[]) => void;
  show?: (criteria: CatalogueHideCriteria[]) => void;
} | null>(null);
export const CatalogueVisibilityProvider = Visibility.Provider;

/** Group rules cover descendants, but a rule for one descendant doesn't hide its parent. */
export function hidesCriteria(
  rule: CatalogueHideCriteria,
  target: CatalogueHideCriteria,
) {
  return (
    (!rule.catalogId || rule.catalogId === target.catalogId) &&
    (!rule.materialId || rule.materialId === target.materialId) &&
    (!rule.categoryId || rule.categoryId === target.categoryId) &&
    (!rule.partId || rule.partId === target.partId) &&
    (!rule.size ||
      (rule.size.nominal === target.size?.nominal &&
        rule.size.unit === target.size?.unit))
  );
}
/**
 * A touch tap sends its click to whatever is under the finger when the click
 * fires. A pick made on lift has already swapped in the next step by then, so
 * that click must not reach the card that appeared there.
 */
function swallowTapClick() {
  const done = () => {
    clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
  };
  const swallow = (event: MouseEvent) => {
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    done();
  };
  const timer = setTimeout(done, 400);
  window.addEventListener("click", swallow, true);
}
export function useCatalogueVisibility(
  criteria: CatalogueHideCriteria | CatalogueHideCriteria[] | undefined,
  onTap: () => void,
) {
  const context = useContext(Visibility);
  const targets = (
    criteria ? (Array.isArray(criteria) ? criteria : [criteria]) : []
  ).map((c) => (c.partId ? c : { ...context?.scope, ...c }));
  const hidden =
    !!context &&
    targets.length > 0 &&
    targets.every((t) =>
      t.partId && context.hiddenPartIds
        ? context.hiddenPartIds.includes(t.partId)
        : context.rules.some((r) => hidesCriteria(r, t) && !r.exceptions?.some(exception => hidesCriteria(exception, t))),
    );
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    cancelled: boolean;
    fired: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const suppressClick = useRef(false);
  const clear = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => () => clear(), []);
  const enabled = !!context?.enabled && targets.length > 0;
  useEffect(() => {
    if (!enabled) clear();
  }, [enabled]);
  const stop = (e: PointerEvent<HTMLElement>) => {
    if (press.current) e.stopPropagation();
  };
  const handlers = !enabled
    ? {}
    : {
        "data-arc-ignore": true,
        onPointerDownCapture: (e: PointerEvent<HTMLElement>) => {
          if (e.button !== 0 || e.isPrimary === false) return;
          // Leave embedded supplier/editor controls to their own actions.
          if (
            e.target instanceof Element &&
            e.target !== e.currentTarget &&
            e.target.closest("button,input,select,a,textarea") &&
            e.target.closest("button,input,select,a,textarea") !== e.currentTarget
          )
            return;
          clear();
          suppressClick.current = false;
          e.stopPropagation();
          const p = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            cancelled: false,
            fired: false,
            timer: setTimeout(() => {
              if (press.current !== p || p.cancelled) return;
              p.fired = true;
              suppressClick.current = true;
              (hidden ? context.show : context.hide)?.(
                (context.acrossAll
                  ? Array.isArray(criteria)
                    ? criteria
                    : [criteria!]
                  : targets
                ).map((t) => (t.partId ? { partId: t.partId } : t)),
              );
            }, 600),
          };
          press.current = p;
        },
        onPointerMoveCapture: (e: PointerEvent<HTMLElement>) => {
          const p = press.current;
          if (!p) return;
          e.stopPropagation();
          if (
            p.id !== e.pointerId ||
            Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8
          ) {
            p.cancelled = true;
            clearTimeout(p.timer);
          }
        },
        onPointerUpCapture: (e: PointerEvent<HTMLElement>) => {
          const p = press.current;
          if (!p) return;
          e.stopPropagation();
          suppressClick.current = true;
          clear();
          if (p.id === e.pointerId && !p.cancelled && !p.fired) {
            swallowTapClick();
            onTap();
          }
        },
        onPointerCancelCapture: (e: PointerEvent<HTMLElement>) => {
          stop(e);
          clear();
          suppressClick.current = true;
        },
        onPointerLeave: () => {
          if (press.current) {
            press.current.cancelled = true;
            clearTimeout(press.current.timer);
          }
        },
        onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
          if (suppressClick.current && e.detail !== 0) {
            e.preventDefault();
            e.stopPropagation();
            suppressClick.current = false;
          }
        },
        onContextMenuCapture: (e: React.MouseEvent<HTMLElement>) => {
          e.preventDefault();
          e.stopPropagation();
        },
      };
  const overlay: ReactNode = hidden ? (
    <span
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-[inherit]"
      aria-label="Hidden from material lists"
    >
      <span className="bg-background/10 text-foreground/35 flex w-[140%] shrink-0 -rotate-12 items-center justify-center gap-2 border-y border-foreground/10 py-2 text-xl font-bold uppercase tracking-widest">
        <EyeOff className="size-5" />
        Hidden
      </span>
    </span>
  ) : null;
  return { handlers, overlay, hidden };
}
