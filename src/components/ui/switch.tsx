import { cn } from "~/lib/utils";

/** Visual on/off track; put it inside a button that owns the state and label. */
export function SwitchTrack({
  checked,
  className,
}: {
  checked: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/30",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-5",
        )}
      />
    </span>
  );
}
