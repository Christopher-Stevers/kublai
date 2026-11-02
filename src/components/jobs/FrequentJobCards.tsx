"use client";
import {
  Children,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useDrawingAccount } from "./DrawingAccountProvider";
import {
  emptyJobCardPreferences,
  readJobCardPreferences,
  saveJobCardPreferences,
  rankJobCards,
  recordJobCard,
  type JobCardId,
} from "~/lib/job-card-frequency";

function useJobCardPreferences() {
  const account = useDrawingAccount();
  const key = account
    ? `foremanhq:job-card-frequency:${account.accountKey}`
    : null;
  const [prefs, setPrefs] = useState(emptyJobCardPreferences);
  useEffect(() => {
    // Hydrate account-local storage after SSR, and reset when the account changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(key ? readJobCardPreferences(key) : emptyJobCardPreferences());
  }, [key]);
  return { key, prefs, setPrefs };
}

export function FrequentJobCardsSetting() {
  const { key, prefs, setPrefs } = useJobCardPreferences();
  return (
    <div className="space-y-2 border-t pt-4">
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
        Frequently used first
        <input
          type="checkbox"
          disabled={!key}
          checked={prefs.frequent}
          onChange={(event) => {
            if (!key) return;
            const next = {
              ...readJobCardPreferences(key),
              frequent: event.target.checked,
            };
            saveJobCardPreferences(key, next);
            setPrefs(next);
          }}
        />
      </label>
      <p className="text-muted-foreground text-sm">
        Show your most-used job cards first. Turn off to use the fixed order.
      </p>
    </div>
  );
}

export function FrequentJobCards({ children, trailingCards }: { children: ReactNode; trailingCards?: ReactNode }) {
  const { key, prefs } = useJobCardPreferences();
  const order = rankJobCards(prefs);
  const cards = Children.toArray(children).filter(
    isValidElement<{ "data-job-card": JobCardId }>,
  );
  cards.sort(
    (a, b) =>
      order.indexOf(a.props["data-job-card"]) -
      order.indexOf(b.props["data-job-card"]),
  );
  const record = (target: EventTarget | null) => {
    if (!key || !(target instanceof Element)) return;
    const id = target
      .closest("[data-job-card]")
      ?.getAttribute("data-job-card") as JobCardId | null;
    if (id && order.includes(id))
      saveJobCardPreferences(
        key,
        recordJobCard(readJobCardPreferences(key), id),
      );
    // Keep this screen stable under the pointer; reorder on the next visit.
  };
  return (
    <div className="space-y-3">
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        onClickCapture={(event) => record(event.target)}
        onKeyDownCapture={(event) => {
          if (!event.repeat && (event.key === "Enter" || event.key === " "))
            record(event.target);
        }}
      >
        {cards}
        {trailingCards}
      </div>
    </div>
  );
}
