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
import { ArrowLeftIcon, CircleDotIcon, XIcon } from "lucide-react";
import {
  QuickWheelSurface,
  useQuickWheelOptions,
} from "~/components/materialLists/wizard/QuickWheel";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

export type DrawingWheelItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  children?: DrawingWheelItem[];
  run?: () => void;
  /** Toggles such as layer checkboxes can be changed without lifting. */
  keepOpen?: boolean;
};
export type DrawingWheelGroup = {
  id: string;
  title: string;
  items: DrawingWheelItem[];
  /** An active measurement / markup becomes the first wheel. */
  priority?: number;
};
type Registry = {
  enabled: boolean;
  register: (group: DrawingWheelGroup) => void;
  remove: (id: string) => void;
  gestures: Map<string, (event: PointerEvent | MouseEvent) => void>;
};
const Context = createContext<Registry | null>(null);
export function useDrawingWheelEnabled() {
  return useContext(Context)?.enabled ?? false;
}

/** Register live callbacks from the same controls used by the regular toolbars. */
export function useDrawingWheelGroup(group: DrawingWheelGroup | null) {
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

export function DrawingWheelRegistration({
  group,
}: {
  group: DrawingWheelGroup | null;
}) {
  useDrawingWheelGroup(group);
  return null;
}

export function useDrawingWheelGesture(
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
  items: DrawingWheelItem[];
  choose: (item: DrawingWheelItem) => void;
}) {
  useQuickWheelOptions(
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

export function DrawingQuickWheel({
  enabled,
  group,
  children,
}: {
  enabled: boolean;
  group: DrawingWheelGroup;
  children: ReactNode;
}) {
  const groups = useRef(new Map<string, DrawingWheelGroup>());
  const signatures = useRef(new Map<string, string>());
  const [registeredGroups, setRegisteredGroups] = useState<DrawingWheelGroup[]>(
    [],
  );
  const [path, setPath] = useState<string[]>([]);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [active, setActive] = useState(false);
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
  const choices: DrawingWheelItem[] = path.length
    ? [
        ...items,
        {
          id: "back",
          label: "Back",
          icon: <ArrowLeftIcon />,
          keepOpen: true,
          run: () => setPath((value) => value.slice(0, -1)),
        },
      ]
    : items;
  const choose = (item: DrawingWheelItem) => {
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
    if (!current && item.id !== "back") return;
    item = current ?? item;
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
      <QuickWheelSurface
        enabled={enabled}
        activation="context"
        activationSelector="[data-drawing-wheel-canvas]"
        showBackBar={false}
        previewChoice={(_, label) => {
          const item = choices.find(
            (value) =>
              (value.selected ? `✓ ${value.label}` : value.label) === label,
          );
          return item?.children
            ? {
                kind: "wheel",
                title: item.label,
                options: [
                  ...item.children.map((value) => ({
                    label: value.selected ? `✓ ${value.label}` : value.label,
                    icon: value.icon ?? <CircleDotIcon aria-hidden="true" />,
                    disabled: value.disabled,
                  })),
                  { label: "Back", icon: <ArrowLeftIcon /> },
                ],
              }
            : undefined;
        }}
        onActivate={(event) => {
          gestures.forEach((cancel) => cancel(event));
        }}
        onActiveChange={(value) => {
          setActive(value);
          if (!value) setPath([]);
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
        {enabled && !active && (
          <span
            className="bg-card/90 text-card-foreground pointer-events-none absolute top-3 left-3 z-20 max-w-[calc(100%-1.5rem)] rounded-full border px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm"
            data-drawing-wheel-hint=""
          >
            {root.title} ·{" "}
            <span className="hidden [@media(pointer:fine)]:inline">
              Right-click for controls
            </span>
            <span className="[@media(pointer:fine)]:hidden">
              Hold for controls
            </span>
          </span>
        )}
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
              <Button variant="ghost" onClick={() => setKeyboardOpen(false)}>
                <XIcon />
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </QuickWheelSurface>
    </Context.Provider>
  );
}
