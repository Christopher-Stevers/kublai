"use client";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";

const queued = new Set<() => Promise<unknown>>();
const features = new Set<() => Promise<unknown>>();
let timer: ReturnType<typeof setTimeout> | undefined;
function warm(load: () => Promise<unknown>) {
  queued.add(load);
  if (timer) return;
  timer = setTimeout(async () => {
    // Load sequentially after first paint, so dialogs remain available offline
    // without competing with the initial scripts or mounting their queries.
    for (const next of queued) {
      if (!navigator.onLine) break;
      queued.delete(next);
      await next().catch(() => {});
    }
    timer = undefined;
  }, 4000);
}

function feature<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  dialog = false,
) {
  features.add(load);
  const Component = lazy(load);
  return function DeferredFeature(props: P) {
    const open = !dialog || !("open" in props) || props.open === true;
    const [opened, setOpened] = useState(open);
    useEffect(() => {
      if (open) setOpened(true);
    }, [open]);
    useEffect(() => {
      warm(load);
      const onOnline = () => warm(load);
      window.addEventListener("online", onOnline);
      return () => window.removeEventListener("online", onOnline);
    }, []);
    if (!open && !opened) return null;
    return (
      <Suspense
        fallback={
          open ? (
            <p role="status" className="p-3 text-sm text-gray-500">
              Loading…
            </p>
          ) : null
        }
      >
        <Component {...props} />
      </Suspense>
    );
  };
}

/** Cache optional features after startup, including ones not yet mounted. */
export function warmDeferredFeatures() {
  for (const load of features) warm(load);
}

export const AddPartDialog = feature<
  ComponentProps<
    typeof import("~/components/materialLists/AddPartDialog").AddPartDialog
  >
>(
  () =>
    import("~/components/materialLists/AddPartDialog").then((m) => ({
      default: m.AddPartDialog,
    })),
  true,
);
export const QuotePreviewSheet = feature<
  ComponentProps<
    typeof import("~/components/materialLists/QuotePreviewSheet").QuotePreviewSheet
  >
>(
  () =>
    import("~/components/materialLists/QuotePreviewSheet").then((m) => ({
      default: m.QuotePreviewSheet,
    })),
  true,
);
export const OrdersPreviewSheet = feature<
  ComponentProps<
    typeof import("~/components/materialLists/OrdersPreviewSheet").OrdersPreviewSheet
  >
>(
  () =>
    import("~/components/materialLists/OrdersPreviewSheet").then((m) => ({
      default: m.OrdersPreviewSheet,
    })),
  true,
);
export const ExistingQuotesOrdersDialog = feature<
  ComponentProps<
    typeof import("~/components/materialLists/ExistingQuotesOrdersDialog").ExistingQuotesOrdersDialog
  >
>(
  () =>
    import("~/components/materialLists/ExistingQuotesOrdersDialog").then(
      (m) => ({ default: m.ExistingQuotesOrdersDialog }),
    ),
  true,
);
export const EditPartDialog = feature<
  ComponentProps<
    typeof import("~/components/catalogue/EditPartDialog").EditPartDialog
  >
>(
  () =>
    import("~/components/catalogue/EditPartDialog").then((m) => ({
      default: m.EditPartDialog,
    })),
  true,
);
export const CreateCustomPartDialog = feature<
  ComponentProps<
    typeof import("~/components/materialLists/CreateCustomPartDialog").CreateCustomPartDialog
  >
>(
  () =>
    import("~/components/materialLists/CreateCustomPartDialog").then((m) => ({
      default: m.CreateCustomPartDialog,
    })),
  true,
);
export const MaterialGroupsDialog = feature<
  ComponentProps<
    typeof import("~/components/catalogue/MaterialGroupsDialog").MaterialGroupsDialog
  >
>(
  () =>
    import("~/components/catalogue/MaterialGroupsDialog").then((m) => ({
      default: m.MaterialGroupsDialog,
    })),
  true,
);
export const PhotoQueueDialog = feature<
  ComponentProps<
    typeof import("~/components/catalogue/PhotoQueueDialog").PhotoQueueDialog
  >
>(
  () =>
    import("~/components/catalogue/PhotoQueueDialog").then((m) => ({
      default: m.PhotoQueueDialog,
    })),
  true,
);
export const JobRoomsView = feature<
  ComponentProps<typeof import("~/components/jobs/JobRoomsView").JobRoomsView>
>(() =>
  import("~/components/jobs/JobRoomsView").then((m) => ({
    default: m.JobRoomsView,
  })),
);
export const PartStage = feature<
  ComponentProps<
    typeof import("~/components/materialLists/wizard/PartStage").PartStage
  >
>(() =>
  import("~/components/materialLists/wizard/PartStage").then((m) => ({
    default: m.PartStage,
  })),
);
