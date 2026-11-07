import { Badge } from "~/components/ui/badge";
import type { DrawStatus } from "~/lib/draws";
import { cn } from "~/lib/utils";

const statusStyles: Record<DrawStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-amber-100 text-amber-900" },
  submitted: { label: "Submitted", className: "bg-blue-100 text-blue-900" },
  paid: { label: "Paid", className: "bg-green-100 text-green-900" },
};

export function DrawStatusBadge({
  status,
  label,
}: {
  status: DrawStatus;
  label?: string;
}) {
  const style = statusStyles[status] ?? statusStyles.draft;
  return (
    <Badge variant="secondary" className={cn(style.className)}>
      {label ? `${label} · ${style.label}` : style.label}
    </Badge>
  );
}
