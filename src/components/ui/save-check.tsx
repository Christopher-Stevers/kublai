import { cn } from "~/lib/utils";

/** A tick that pops in and draws itself; remount (change its key) to replay. */
export function SaveCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={cn("save-check text-success size-4 shrink-0", className)}
    >
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity=".16" />
      <path
        className="save-check-tick"
        pathLength={1}
        d="M6 10.5l2.6 2.6L14 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
