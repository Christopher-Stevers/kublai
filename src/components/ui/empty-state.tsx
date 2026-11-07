import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type Art = "blueprint" | "clipboard" | "hardhat" | "folder";

/** One-colour line drawings; they follow the text colour so they suit both themes. */
function EmptyArt({ art }: { art: Art }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 96 72" className="h-16 w-20" aria-hidden>
      {art === "blueprint" && (
        <g {...line}>
          <path d="M18 18h52a8 8 0 0 1 8 8v28H26a8 8 0 0 1-8-8z" />
          <path d="M18 18a8 8 0 0 0-8 8v20a8 8 0 0 0 16 0V26a8 8 0 0 0-8-8" />
          <path d="M18 46a4 4 0 0 1 0-8" opacity=".5" />
          <path d="M36 28h30v18H36zM50 28v10M36 38h14" opacity=".55" />
          <path d="M82 24v34M80 58h4" opacity=".35" />
        </g>
      )}
      {art === "clipboard" && (
        <g {...line}>
          <rect x="26" y="12" width="44" height="54" rx="6" />
          <path d="M38 12v-2a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v2" />
          <rect x="38" y="8" width="20" height="9" rx="3" />
          <path
            d="M36 32h24M36 42h24M36 52h14"
            opacity=".45"
            strokeDasharray="2 5"
          />
        </g>
      )}
      {art === "hardhat" && (
        <g {...line}>
          <path d="M22 50a26 26 0 0 1 52 0" />
          <path d="M14 50h68a4 4 0 0 1 0 8H14a4 4 0 0 1 0-8z" />
          <path d="M42 25v-4a6 6 0 0 1 12 0v4" />
          <path d="M48 21v29" opacity=".45" />
          <path
            d="M33 33a18 18 0 0 0-3 17M63 33a18 18 0 0 1 3 17"
            opacity=".45"
          />
        </g>
      )}
      {art === "folder" && (
        <g {...line}>
          <path d="M14 22a6 6 0 0 1 6-6h18l6 7h32a6 6 0 0 1 6 6v29a6 6 0 0 1-6 6H20a6 6 0 0 1-6-6z" />
          <path d="M14 31h68" opacity=".45" />
          <path d="M48 39v14M41 46l7-7 7 7" opacity=".6" />
        </g>
      )}
    </svg>
  );
}

/** A small drawing, one line of copy and the action that fills the space. */
export function EmptyState({
  art,
  title,
  action,
  className,
}: {
  art: Art;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="text-primary/45">
        <EmptyArt art={art} />
      </span>
      <p className="text-muted-foreground text-sm">{title}</p>
      {action}
    </div>
  );
}
