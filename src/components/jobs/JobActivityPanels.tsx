"use client";
import {
  Activity,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  isAppPageActive,
  subscribeAppPageActivity,
} from "~/lib/app-page-activity";
const serverActive = () => true;
type Panel = { key: string; node: ReactNode };
/** Only previously visited, reviewed workspace panels are retained. The caller
 * owns the job/account key and excludes editors whose effect cleanup cancels a
 * pending save. This never changes the outer app-window activity state. */
export function JobActivityPanels({
  activeKey,
  children,
}: {
  activeKey: string;
  children: ReactNode;
}) {
  const pageActive = useSyncExternalStore(
    subscribeAppPageActivity,
    isAppPageActive,
    serverActive,
  );
  const [retained, setRetained] = useState<Panel[]>(() => [
    { key: activeKey, node: children },
  ]);
  // The active child is always rendered immediately, before cache bookkeeping.
  // At most two visited inactive panels survive; no unopened screen is rendered.
  const panels = [
    { key: activeKey, node: children },
    ...(pageActive ? retained.filter((panel) => panel.key !== activeKey) : []),
  ].slice(0, 3);
  useLayoutEffect(() => {
    setRetained((previous) =>
      [
        { key: activeKey, node: children },
        ...(pageActive
          ? previous.filter((panel) => panel.key !== activeKey)
          : []),
      ].slice(0, 3),
    );
  }, [activeKey, children, pageActive]);
  return (
    <>
      {panels.map((panel) => (
        <Activity
          key={panel.key}
          mode={pageActive && panel.key === activeKey ? "visible" : "hidden"}
        >
          <div
            data-job-panel={panel.key}
            data-job-panel-active={panel.key === activeKey ? "true" : undefined}
            style={{ display: "contents" }}
          >
            {panel.node}
          </div>
        </Activity>
      ))}
    </>
  );
}
