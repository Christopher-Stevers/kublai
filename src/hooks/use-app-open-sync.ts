"use client";

// Hard local-only mode for field workflow data.
// App-open server imports are disabled so jobs, material lists, suppliers, and
// catalogue snapshots are not overwritten by server reads on page load.
export function useAppOpenSync() {
  // no-op
}
