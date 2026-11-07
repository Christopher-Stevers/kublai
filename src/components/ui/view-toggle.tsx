"use client";

import { Button } from "~/components/ui/button";
import { Grid3x3, Table2 } from "lucide-react";
import { cn } from "~/lib/utils";

interface ViewToggleProps {
  view: "grid" | "table";
  onViewChange: (view: "grid" | "table") => void;
  showOnMobile?: boolean;
}

export function ViewToggle({
  view,
  onViewChange,
  showOnMobile = false,
}: ViewToggleProps) {
  return (
    <div
      className={cn(
        "flex h-10 w-[5.75rem] shrink-0 items-center justify-between gap-1 rounded-lg border border-border bg-card p-1",
        showOnMobile ? "flex" : "hidden md:flex",
      )}
    >
      <Button
        variant={view === "grid" ? "default" : "ghost"}
        size="sm"
        onClick={() => onViewChange("grid")}
        className={cn(
          "h-8 w-10 shrink-0 px-0",
          view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
        )}
        aria-label="Grid view"
      >
        <Grid3x3 className="h-4 w-4" />
      </Button>
      <Button
        variant={view === "table" ? "default" : "ghost"}
        size="sm"
        onClick={() => onViewChange("table")}
        className={cn(
          "h-8 w-10 shrink-0 px-0",
          view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
        )}
        aria-label="Table view"
      >
        <Table2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

