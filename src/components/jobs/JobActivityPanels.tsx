"use client";
import {
  Activity,
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
  // The active child always comes directly from current props.
  // At most two visited inactive panels survive; no unopened screen is rendered.
  const panels = [
    { key: activeKey, node: children },
    ...(pageActive ? retained.filter((panel) => panel.key !== activeKey) : []),
  ].slice(0, 3);
  // Pure, bounded adjustment of this component's own state. React retries this
  // render before committing children; stable props make the equality guard
  // terminate. An abandoned concurrent render cannot publish a ref-held panel.
  if (
    panels.length !== retained.length ||
    panels.some(
      (panel, index) =>
        panel.key !== retained[index]?.key ||
        panel.node !== retained[index]?.node,
    )
  ) {
    setRetained(panels);
  }
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
