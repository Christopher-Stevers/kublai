"use client";
import { useEffect } from "react";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Screen failed", error);
  }, [error]);
  return (
    <main role="alert" className="mx-auto max-w-lg p-6">
      <h2 className="text-lg font-semibold">This screen could not load</h2>
      <p className="mt-2">Check your connection, then try again.</p>
      <button className="mt-4 rounded-md border px-4 py-2" onClick={reset}>
        Try again
      </button>
      <button
        className="ml-2 rounded-md border px-4 py-2"
        onClick={() => window.location.reload()}
      >
        Reload app
      </button>
    </main>
  );
}
