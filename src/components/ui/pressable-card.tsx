"use client";
import type { ComponentProps } from "react";
import { Card } from "./card";
import { usePress, type PressPreparation } from "~/hooks/use-press";
import { cn } from "~/lib/utils";

/** Cards scroll with their list: prepare on down, activate only on release. */
export function PressableCard({
  prepare,
  feedback,
  onClick,
  onKeyDown,
  onPointerDown,
  onKeyUp,
  onBlur,
  className,
  ...props
}: ComponentProps<typeof Card> & { prepare?: PressPreparation; feedback?: "state" | "attribute" }) {
  const { pressProps } = usePress<HTMLDivElement>({
    press: "scroll",
    onClick,
    prepare,
    feedback,
  });
  return (
    <Card
      {...props}
      {...pressProps}
      className={cn(
        className,
        "data-[pressed=true]:opacity-75 data-[pressed=true]:transition-none",
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented) pressProps.onPointerDown(event);
      }}
      onKeyUp={(event) => {
        onKeyUp?.(event);
        pressProps.onKeyUp();
      }}
      onBlur={(event) => {
        onBlur?.(event);
        pressProps.onBlur();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.target !== event.currentTarget)
          return;
        pressProps.onKeyDown(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
    />
  );
}
