"use client";

import {
  Component,
  lazy,
  Suspense,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { FileComparison as Content } from "./FileComparisonContent";

export type FileComparisonProps = ComponentProps<typeof Content>;
const loadComparison = () =>
  lazy(() =>
    import("./FileComparisonContent").then((module) => ({
      default: module.FileComparison,
    })),
  );

function CloseComparison({ onClose }: Pick<FileComparisonProps, "onClose">) {
  return (
    <button
      type="button"
      className="rounded-md border px-3 py-2 text-sm"
      onClick={onClose}
      aria-label="Close comparison"
    >
      Close comparison
    </button>
  );
}

/** Local retry preserves the caller's selected comparison and receiving draft.
 * There is deliberately no app reload action on this private viewer boundary. */
class ComparisonBoundary extends Component<
  {
    children: ReactNode;
    onRetry: () => void;
    onClose: () => void;
    allowReload: false;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("Comparison failed to load", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section aria-label="Compare files" className="space-y-3 p-4">
        <p role="alert">
          Comparison could not load. Check your connection and try again.
        </p>
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => {
            this.props.onRetry();
            this.setState({ failed: false });
          }}
        >
          Try again
        </button>
        <CloseComparison onClose={this.props.onClose} />
      </section>
    );
  }
}

/** Callers mount this only after comparison is selected. No viewer is preloaded. */
export function FileComparison(props: FileComparisonProps) {
  const [Panel, setPanel] = useState(loadComparison);
  return (
    <ComparisonBoundary
      allowReload={false}
      onClose={props.onClose}
      onRetry={() => setPanel(loadComparison)}
    >
      <Suspense
        fallback={
          <section aria-label="Compare files" className="space-y-3 p-4">
            <p role="status">Loading comparison…</p>
            <CloseComparison onClose={props.onClose} />
          </section>
        }
      >
        <Panel {...props} />
      </Suspense>
    </ComparisonBoundary>
  );
}
