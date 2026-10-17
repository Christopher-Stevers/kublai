"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { DRAWING_DESTINATION_EVENT } from "~/lib/snapshot-source";

export const HYPERLINK_VISIT_EVENT = "foremanhq:hyperlink-visit";
export function rememberHyperlinkSource(source: string, target: string) {
  window.dispatchEvent(
    new CustomEvent(HYPERLINK_VISIT_EVENT, { detail: { source, target } }),
  );
}
type Visit = { source: string; target: string };
/** Session-only parents for deliberate hyperlink excursions, not browsing history. */
export function useHyperlinkBack(pathname: string | null, sessionKey?: string) {
  const router = useRouter();
  const visits = useRef<Visit[]>([]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    visits.current = [];
    setCount(0);
    const onVisit = (event: Event) => {
      const detail = (event as CustomEvent<Partial<Visit>>).detail;
      if (
        typeof detail?.source !== "string" ||
        typeof detail.target !== "string"
      )
        return;
      try {
        const source = new URL(detail.source, location.origin),
          target = new URL(detail.target, location.origin);
        if (
          [source, target].some(
            (url) =>
              url.origin !== location.origin ||
              !(
                url.pathname === "/dashboard" ||
                url.pathname.startsWith("/dashboard/")
              ),
          )
        )
          return;
        visits.current = [
          ...visits.current.slice(-19),
          {
            source: source.pathname + source.search + source.hash,
            target: target.pathname + target.search + target.hash,
          },
        ];
        setCount(visits.current.length);
      } catch {
        /* Ignore invalid destinations. */
      }
    };
    window.addEventListener(HYPERLINK_VISIT_EVENT, onVisit);
    return () => {
      window.removeEventListener(HYPERLINK_VISIT_EVENT, onVisit);
      visits.current = [];
    };
  }, [sessionKey]);
  useEffect(() => {
    const current = visits.current.at(-1);
    if (
      current &&
      new URL(current.target, location.origin).pathname !== pathname
    ) {
      visits.current = [];
      setCount(0);
    }
  }, [pathname]);
  useHeaderBackOverride(
    count
      ? () => {
          const visit = visits.current.pop();
          setCount(visits.current.length);
          if (!visit) return;
          // Same-route drawing views need the saved position reapplied explicitly.
          window.dispatchEvent(
            new CustomEvent(DRAWING_DESTINATION_EVENT, {
              detail: new URL(visit.source, location.origin).href,
            }),
          );
          router.replace(visit.source, { scroll: false });
        }
      : null,
    { priority: 10, scope: sessionKey },
  );
  return count > 0;
}
