"use client";
import { DownloadIcon } from "lucide-react";
import { useDrawingDownloads } from "~/hooks/use-drawing-downloads";
import { drawingDownloadQueue } from "~/lib/drawing-download-queue";
import { useDrawingAccount } from "./DrawingAccountProvider";
export function DrawingDownloadStatus() {
  const account = useDrawingAccount();
  const tasks = useDrawingDownloads().filter(
    (task) =>
      task.account === account?.accountKey && task.status !== "cancelled",
  );
  if (!tasks.length) return null;
  const pending = tasks.filter(
    (task) => task.status === "queued" || task.status === "running",
  ).length;
  return (
    <details className="relative text-sm" aria-label="Drawing downloads">
      <summary
        aria-label={`Downloads: ${pending ? `${pending} in progress` : tasks.some((task) => task.status === "failed") ? "needs attention" : "complete"}`}
        className="hover:bg-accent relative flex size-11 cursor-pointer list-none items-center justify-center rounded-md [&::-webkit-details-marker]:hidden"
      >
        <DownloadIcon className="size-5" />
        {pending > 0 && (
          <span className="bg-primary text-primary-foreground absolute top-0 right-0 min-w-4 rounded-full px-1 text-center text-[10px]">
            {pending}
          </span>
        )}
      </summary>
      <ul
        aria-label="Drawing download progress"
        className="bg-background absolute top-full right-0 z-50 mt-2 max-h-72 w-[min(22rem,calc(100vw-2rem))] space-y-3 overflow-auto rounded-lg border p-3 shadow-lg"
      >
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-3">
            <span>
              <strong>{task.label}</strong> ·{" "}
              <span role="status">{task.progress}</span>
            </span>
            <button
              className="rounded border px-3 py-1"
              onClick={() =>
                pending && ["queued", "running"].includes(task.status)
                  ? drawingDownloadQueue.cancel(task.id)
                  : drawingDownloadQueue.dismiss(task.id)
              }
            >
              {["queued", "running"].includes(task.status)
                ? "Cancel"
                : "Dismiss"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
