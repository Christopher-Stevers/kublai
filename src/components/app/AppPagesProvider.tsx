"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LayersIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

import { setAppPageActive } from "~/lib/app-page-activity";
import { getPageWindowMode, pageDevice } from "~/lib/page-window-mode";

const subscribeFrame = () => () => undefined;
const isEmbedded = () => window.parent !== window;
const serverEmbedded = () => false;

const CHANNEL = "foremanhq-open-pages-v1";
type Page = { id: string; href: string; title: string; initialHref?: string };
type PagesContext = {
  count: number;
  show: () => void;
  open: (href: string) => void;
};
const Context = createContext<PagesContext | null>(null);
export const useAppPages = () => useContext(Context);

export function appPageHref(value: string, origin: string) {
  try {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      !(url.pathname === "/jobs" || url.pathname.startsWith("/jobs/"))
    )
      return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Separate, mounted browsing contexts retain drafts, canvas state and scroll.
 * Only the outer app owns pages; embedded pages send validated same-origin events. */
export function AppPagesProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [pages, setPages] = useState<Page[]>([
    { id: "main", href: "/jobs", title: "Jobs" },
  ]);
  const [active, setActive] = useState("main");
  const [show, setShow] = useState(false);
  const embedded = useSyncExternalStore(
    subscribeFrame,
    isEmbedded,
    serverEmbedded,
  );
  const [outerCount, setOuterCount] = useState(1);
  const [outerActive, setOuterActive] = useState(true);
  const main = useRef<HTMLDivElement>(null);
  const mainScroll = useRef({ x: 0, y: 0 });
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const current = useRef({ pages, active });
  useLayoutEffect(() => {
    current.current = { pages, active };
  }, [pages, active]);

  const send = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      window.parent.postMessage(
        { channel: CHANNEL, type, ...payload },
        window.location.origin,
      );
    },
    [],
  );
  const open = useCallback(
    (value: string) => {
      const href = appPageHref(value, window.location.origin);
      if (!href) return;
      if (getPageWindowMode(pageDevice()) === "external") {
        window.open(href, "_blank", "noopener,noreferrer,popup,width=1200,height=900");
        setShow(false);
        return;
      }
      if (window.parent !== window) {
        send("open", { href });
        return;
      }
      const id = crypto.randomUUID();
      if (current.current.active === "main")
        mainScroll.current = { x: window.scrollX, y: window.scrollY };
      setPages((old) => [
        ...old,
        { id, href, initialHref: href, title: "Loading page…" },
      ]);
      setActive(id);
      setShow(false);
    },
    [send],
  );
  const showPages = useCallback(() => {
    if (window.parent !== window) send("show");
    else setShow(true);
  }, [send]);

  useEffect(() => {
    const inside = window.parent !== window;
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin ||
        (event.data as { channel?: unknown } | null)?.channel !== CHANNEL
      )
        return;
      const message = event.data as {
        type?: string;
        href?: unknown;
        title?: unknown;
        count?: unknown;
        active?: unknown;
      };
      if (inside) {
        if (
          event.source === window.parent &&
          message.type === "state" &&
          typeof message.count === "number"
        ) {
          setOuterCount(message.count);
          if (typeof message.active === "boolean") setOuterActive(message.active);
        }
        return;
      }
      const entry = [...frames.current].find(
        ([, frame]) => frame.contentWindow === event.source,
      );
      if (!entry) return;
      const [id, frame] = entry;
      if (message.type === "ready")
        frame.contentWindow?.postMessage(
          {
            channel: CHANNEL,
            type: "state",
            count: current.current.pages.length,
            active: id === current.current.active,
          },
          window.location.origin,
        );
      if (
        message.type === "metadata" &&
        typeof message.href === "string" &&
        typeof message.title === "string"
      ) {
        const href = appPageHref(message.href, window.location.origin);
        if (href)
          setPages((old) =>
            old.map((page) =>
              page.id === id
                ? {
                    ...page,
                    href,
                    title: (message.title as string).slice(0, 120),
                  }
                : page,
            ),
          );
      }
      // Background pages cannot open or focus other pages.
      if (id !== current.current.active) return;
      if (message.type === "show") {
        (frame.contentDocument?.activeElement as HTMLElement | null)?.blur();
        setShow(true);
      }
      if (message.type === "open" && typeof message.href === "string")
        open(message.href);
    };
    window.addEventListener("message", receive);
    if (inside) send("ready");
    return () => window.removeEventListener("message", receive);
  }, [open, send]);

  useEffect(() => {
    if (embedded) return;
    for (const [id, frame] of frames.current)
      frame.contentWindow?.postMessage(
        { channel: CHANNEL, type: "state", count: pages.length, active: id === active },
        window.location.origin,
      );
  }, [pages.length, embedded, active]);

  useLayoutEffect(() => {
    setAppPageActive(embedded ? outerActive : active === "main");
  }, [embedded, outerActive, active]);
  useEffect(() => () => setAppPageActive(true), []);

  useEffect(() => {
    let previous = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = () => {
      const href = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const title =
        [
          main.current
            ?.querySelector("main h1, main h2, [data-page-title]")
            ?.textContent?.trim(),
          document.title.split(" - ")[0],
        ].find((value) => !!value) ?? "ForemanHQ";
      const key = `${href}|${title}`;
      if (key === previous) return;
      previous = key;
      if (window.parent !== window) send("metadata", { href, title });
      else
        setPages((old) =>
          old.map((page) =>
            page.id === "main" ? { ...page, href, title } : page,
          ),
        );
    };
    report();
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(report, 250);
    });
    if (main.current)
      observer.observe(main.current, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    window.addEventListener("popstate", report);
    window.addEventListener("hashchange", report);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      window.removeEventListener("popstate", report);
      window.removeEventListener("hashchange", report);
    };
  }, [pathname, params, send]);

  useEffect(() => {
    if (active !== "main" || embedded) return;
    const frame = requestAnimationFrame(() =>
      window.scrollTo({
        left: mainScroll.current.x,
        top: mainScroll.current.y,
        behavior: "instant",
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [active, embedded]);

  const close = (id: string) => {
    if (pages.length === 1) {
      window.location.assign("/jobs");
      return;
    }
    const remaining = pages.filter((page) => page.id !== id);
    setPages(remaining);
    if (active === id) setActive(remaining.at(-1)?.id ?? "main");
  };

  return (
    <Context.Provider
      value={{
        count: embedded ? outerCount : pages.length,
        show: showPages,
        open,
      }}
    >
      <div
        ref={main}
        style={!embedded && active !== "main" ? { display: "none" } : undefined}
      >
        {children}
      </div>
      {!embedded &&
        pages
          .filter((page) => page.id !== "main")
          .map((page) => (
            <iframe
              key={page.id}
              ref={(frame) => {
                if (frame) frames.current.set(page.id, frame);
                else frames.current.delete(page.id);
              }}
              // Keep the initial URL stable: metadata changes must never reload the frame.
              src={page.initialHref}
              onLoad={(event) => {
                event.currentTarget.contentWindow?.postMessage(
                  {
                    channel: CHANNEL,
                    type: "state",
                    count: current.current.pages.length,
                    active: page.id === current.current.active,
                  },
                  window.location.origin,
                );
              }}
              data-page-id={page.id}
              title={page.title}
              className="bg-background fixed inset-0 z-[80] h-dvh w-full border-0"
              style={{ display: active === page.id ? "block" : "none" }}
              allow="camera; microphone; fullscreen; clipboard-write"
            />
          ))}
      {!embedded && (
        <Dialog open={show} onOpenChange={setShow}>
          <DialogContent
            layerClassName="z-[120] items-end p-0 sm:items-center sm:p-4"
            className="flex max-h-[85dvh] max-w-full flex-col rounded-t-2xl rounded-b-none pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-lg sm:rounded-lg"
          >
            <DialogHeader>
              <DialogTitle>Open pages</DialogTitle>
              <DialogDescription>
                {pages.length} open · Switch without losing your place
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 space-y-2 overflow-y-auto">
              {pages.map((page) => (
                <div
                  key={page.id}
                  className={`flex items-center gap-2 rounded-xl border p-2 ${active === page.id ? "border-primary bg-primary/10" : ""}`}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
                    aria-current={active === page.id ? "page" : undefined}
                    onClick={() => {
                      if (active === "main")
                        mainScroll.current = {
                          x: window.scrollX,
                          y: window.scrollY,
                        };
                      setActive(page.id);
                      setShow(false);
                    }}
                  >
                    <LayersIcon className="size-5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {page.title}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {active === page.id ? "Current · " : ""}
                        {page.href.split("?")[0]}
                      </span>
                    </span>
                  </button>
                  {
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Close ${page.title}`}
                      onClick={() => close(page.id)}
                    >
                      <XIcon />
                    </Button>
                  }
                </div>
              ))}
            </div>
            <Button variant="outline" onClick={() => open("/jobs")}>
              <PlusIcon />
              Open another page
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </Context.Provider>
  );
}
