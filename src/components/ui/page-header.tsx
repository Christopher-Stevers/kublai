import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * Title block shared by every screen so titles sit, size and read the same.
 * "page" is a top-level screen (Jobs, Orders, Suppliers…); "section" is a
 * screen inside a job (Material Lists, Drawings, Documents…), where the job
 * is already the context.
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
  level = "page",
  className,
  titleProps,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or links beside the title on wide screens, below it on phones. */
  actions?: ReactNode;
  /** Extra lines under the description, such as an offline badge. */
  children?: ReactNode;
  level?: "page" | "section";
  className?: string;
  titleProps?: HTMLAttributes<HTMLHeadingElement> &
    Record<`data-${string}`, string>;
}) {
  const Heading = level === "page" ? "h1" : "h2";
  return (
    <header
      className={cn(
        "mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <Heading
          {...titleProps}
          className={cn(
            "text-foreground min-w-0 break-words",
            level === "page"
              ? "text-2xl font-bold sm:text-3xl"
              : "text-xl font-semibold sm:text-2xl",
            titleProps?.className,
          )}
        >
          {title}
        </Heading>
        {description && (
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            {description}
          </p>
        )}
        {children}
      </div>
      {actions}
    </header>
  );
}
