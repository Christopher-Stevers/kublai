"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import {
  usePress,
  type PressMode,
  type PressPreparation,
} from "~/hooks/use-press";
import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "capitalize inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border border-input bg-card shadow-sm hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  press = "release",
  prepare,
  onClick,
  onPointerDown,
  onKeyDown,
  onKeyUp,
  onBlur,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    press?: PressMode;
    prepare?: PressPreparation;
  }) {
  const Comp = asChild ? Slot : "button";
  const { pressProps } = usePress<HTMLButtonElement>({
    // Slot children may own navigation or a Radix trigger; their native click
    // must remain intact. Explicit destructive styling also stays on release.
    press: asChild || variant === "destructive" ? "release" : press,
    prepare,
    disabled,
    onClick,
  });

  return (
    <Comp
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size, className }),
        "data-[pressed=true]:opacity-75 data-[pressed=true]:transition-none",
      )}
      {...props}
      {...pressProps}
      disabled={disabled}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented) pressProps.onPointerDown(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) pressProps.onKeyDown(event);
      }}
      onKeyUp={(event) => {
        onKeyUp?.(event);
        pressProps.onKeyUp();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        pressProps.onBlur();
      }}
    />
  );
}

function LargeButton({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    press?: PressMode;
    prepare?: PressPreparation;
  }) {
  return (
    <Button
      className={cn(
        "min-h-[64px] min-w-[64px]",
        buttonVariants({ variant, size, className }),
      )}
      {...props}
    />
  );
}

export { Button, LargeButton, buttonVariants };
