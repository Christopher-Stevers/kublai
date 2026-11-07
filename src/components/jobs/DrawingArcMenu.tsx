"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { ArrowLeftIcon, CircleDotIcon, XIcon } from "lucide-react";
import {
  ArcScrollerSurface,
  useArcScrollerOptions,
} from "~/components/ui/arc-scroller";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

export type DrawingArcItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  children?: DrawingArcItem[];
  run?: () => void;
  /** Toggles such as layer checkboxes can be changed without lifting. */
  keepOpen?: boolean;
};
export type DrawingArcGroup = {
  id: string;
  title: string;
  items: DrawingArcItem[];
  /** An active measurement / markup becomes the first menu. */
  priority?: number;
};
type Registry = {
  enabled: boolean;
  register: (group: DrawingArcGroup) => void;
  remove: (id: string) => void;
  gestures: Map<string, (event: PointerEvent | MouseEvent) => void>;
};
const Context = createContext<Registry | null>(null);
export function useDrawingArcEnabled() {
  return useContext(Context)?.enabled ?? false;
}

/** Register live callbacks from the same controls used by the regular toolbars. */
export function useDrawingArcGroup(group: DrawingArcGroup | null) {
  const registry = useContext(Context);
  useLayoutEffect(() => {
    if (group && registry?.enabled) registry.register(group);
  });
  const id = group?.id;
  useLayoutEffect(
    () => () => {
      if (id) registry?.remove(id);
    },
    [registry, id],
  );
  return registry?.enabled ?? false;
}

export function DrawingArcRegistration({
  group,
}: {
  group: DrawingArcGroup | null;
}) {
  useDrawingArcGroup(group);
  return null;
}

export function useDrawingArcGesture(
  id: string,
  cancel: (event: PointerEvent | MouseEvent) => void,
) {
  const registry = useContext(Context);
  useLayoutEffect(() => {
    registry?.gestures.set(id, cancel);
    return () => {
      registry?.gestures.delete(id);
    };
  });
  return registry?.enabled ?? false;
}

function Options({
  title,
  items,
  choose,
}: {
  title: string;
  items: DrawingArcItem[];
  choose: (item: DrawingArcItem) => void;
}) {
  useArcScrollerOptions(
    title,
    items.map((item) => ({
      label: item.selected ? `✓ ${item.label}` : item.label,
      icon: item.icon ?? <CircleDotIcon aria-hidden="true" />,
      disabled: item.disabled,
      dismiss: !item.children && !item.keepOpen,
      select: () => choose(item),
    })),
  );
  return null;
}

export function DrawingArcMenu({
  enabled,
  resetKey,
  allowItemHold = false,
  onTemporaryChange,
  group,
  children,
}: {
  enabled: boolean;
  resetKey?: string | number | boolean;
  /** Regular controls may borrow the arc menu for an existing annotation only. */
  allowItemHold?: boolean;
  onTemporaryChange?: (active: boolean) => void;
  group: DrawingArcGroup;
  children: ReactNode;
}) {
  const temporary = useRef(false);
  const groups = useRef(new Map<string, DrawingArcGroup>());
  const signatures = useRef(new Map<string, string>());
  const [registeredGroups, setRegisteredGroups] = useState<DrawingArcGroup[]>(
    [],
  );
  const [path, setPath] = useState<string[]>([]);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useLayoutEffect(() => { setKeyboardOpen(false); setPath([]); }, [resetKey]);
  useHeaderBackOverride(enabled && keyboardOpen ? () => {
    if (path.length) setPath(value => value.slice(0, -1));
    else setKeyboardOpen(false);
  } : null, { priority: 130 });
  const gestures = useMemo(
    () => new Map<string, (event: PointerEvent | MouseEvent) => void>(),
    [],
  );
  const registry = useMemo<Registry>(
    () => ({
      enabled,
      gestures,
      register(value) {
        groups.current.set(value.id, value);
        const signature = JSON.stringify(value, (key, value: unknown) =>
          key === "icon" || key === "run" ? undefined : value,
        );
        if (signatures.current.get(value.id) !== signature) {
          signatures.current.set(value.id, signature);
          setRegisteredGroups([...groups.current.values()]);
        }
      },
      remove(id) {
        if (groups.current.delete(id)) {
          signatures.current.delete(id);
          setRegisteredGroups([...groups.current.values()]);
        }
      },
    }),
    [enabled, gestures],
  );
  const contextGroup = registeredGroups
    .slice()
    .filter((value) => value.priority && value.items.length)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  const root = contextGroup
    ? {
        ...contextGroup,
        items: [
          ...contextGroup.items,
          { id: "drawing", label: "Drawing tools", children: group.items },
        ],
      }
    : group;
  let items = root.items;
  let title = root.title;
  for (const id of path) {
    const child = items.find((item) => item.id === id);
    if (!child?.children) break;
    items = child.children;
    title = child.label;
  }
  const choices = items;
  const back = path.length ? () => setPath((value) => value.slice(0, -1)) : undefined;
  const choose = (item: DrawingArcItem) => {
    // Child tools can refresh their callbacks without changing the menu labels.
    // Resolve the action at selection time so a saved run / permission is current.
    const latest = contextGroup ? groups.current.get(contextGroup.id) : group;
    if (!latest) return;
    let liveItems = contextGroup
      ? [
          ...latest.items,
          { id: "drawing", label: "Drawing tools", children: group.items },
        ]
      : latest.items;
    for (const id of path) {
      const next = liveItems.find((value) => value.id === id)?.children;
      if (!next) return;
      liveItems = next;
    }
    const current = liveItems.find((value) => value.id === item.id);
    if (!current) return;
    item = current;
    if (item.disabled) return;
    if (item.children) setPath((value) => [...value, item.id]);
    else {
      item.run?.();
      if (!item.keepOpen) {
        setKeyboardOpen(false);
        setPath([]);
      }
    }
  };
  return (
    <Context.Provider value={registry}>
      <ArcScrollerSurface
        enabled={enabled || allowItemHold}
        resetKey={resetKey}
        activation="context"
        activationSelector={enabled ? "[data-drawing-arc-canvas]" : "[data-drawing-arc-canvas] [data-annotation-id]"}
        showBackdrop={false}
        onBack={back}
        onActivate={(event) => {
          if (!enabled && allowItemHold) {
            temporary.current = true;
            onTemporaryChange?.(true);
          }
          gestures.forEach((cancel) => cancel(event));
        }}
        onActiveChange={(value) => {
          if (!value) {
            setPath([]);
            if (temporary.current) {
              temporary.current = false;
              onTemporaryChange?.(false);
            }
          }
        }}
        className="relative flex h-full min-h-0 flex-col"
        onKeyDownCapture={(event) => {
          if (
            !enabled ||
            !(
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            )
          )
            return;
          if (
            event.target instanceof Element &&
            event.target.closest(
              "input, textarea, select, [contenteditable=true]",
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          setPath([]);
          setKeyboardOpen(true);
        }}
      >
        <Options title={title} items={choices} choose={choose} />
        {children}
        <Dialog open={enabled && keyboardOpen} onOpenChange={setKeyboardOpen}>
          <DialogContent layerClassName="z-[110]">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>Choose a drawing action.</DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[60dvh] grid-cols-2 gap-2 overflow-y-auto">
              {choices.map((item) => (
                <Button
                  key={item.id}
                  variant="outline"
                  disabled={item.disabled}
                  className="h-auto min-h-12 whitespace-normal"
                  onClick={() => choose(item)}
                >
                  {item.icon}
                  {item.selected ? "✓ " : ""}
                  {item.label}
                </Button>
              ))}
              {back && (
                <Button variant="outline" onClick={back}>
                  <ArrowLeftIcon />
                  Back
                </Button>
              )}
              <Button variant="ghost" onClick={() => setKeyboardOpen(false)}>
                <XIcon />
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </ArcScrollerSurface>
    </Context.Provider>
  );
}
