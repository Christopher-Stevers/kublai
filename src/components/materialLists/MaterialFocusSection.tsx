import type { HTMLAttributes } from "react";
import styles from "./MaterialFocusSection.module.css";

/** A transient outline follows the same focus state as the footer. */
export function MaterialFocusSection({ focused = false, className = "", ...props }:
  HTMLAttributes<HTMLElement> & { focused?: boolean }) {
  return <section {...props} data-material-focused={focused || undefined}
    className={`${styles.section} ${className}`} />;
}
