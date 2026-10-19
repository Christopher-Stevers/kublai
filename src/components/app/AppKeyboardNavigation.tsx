"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  activeShortcutDialog,
  keyboardShortcutBlocked,
} from "~/lib/keyboard-shortcuts";

export function AppKeyboardNavigation() {
  const router = useRouter();
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        !["ArrowLeft", "ArrowRight"].includes(event.key) ||
        keyboardShortcutBlocked(event)
      )
        return;
      if (window.getSelection()?.isCollapsed === false) return;
      const dialog = activeShortcutDialog();
      if (dialog && !dialog.querySelector("[data-drawing-keyboard-surface]"))
        return;
      event.preventDefault();
      if (event.key === "ArrowLeft") router.back();
      else router.forward();
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [router]);
  return null;
}
