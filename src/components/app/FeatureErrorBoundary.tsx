"use client";
import { Component, type ReactNode } from "react";
export class FeatureErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("Feature failed to load", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-md border p-4 text-sm">
        <p>This screen could not load. Check your connection and try again.</p>
        <button
          className="mt-3 rounded-md border px-3 py-2"
          onClick={() => {
            this.props.onRetry();
            this.setState({ failed: false });
          }}
        >
          Try again
        </button>
        <button
          className="ml-2 rounded-md border px-3 py-2"
          onClick={() => window.location.reload()}
        >
          Reload app
        </button>
      </div>
    );
  }
}
