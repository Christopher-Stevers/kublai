import type { CSSProperties } from "react";
import {
  ClipboardListIcon,
  DrillIcon,
  HammerIcon,
  HardHatIcon,
  PencilRulerIcon,
  RulerIcon,
  ShoppingCartIcon,
  WrenchIcon,
} from "lucide-react";

import { APP_NAME } from "~/constants/app";
import styles from "./AppStartupLoading.module.css";

const TOOLS = [
  WrenchIcon,
  HammerIcon,
  DrillIcon,
  RulerIcon,
  PencilRulerIcon,
  HardHatIcon,
  ClipboardListIcon,
  ShoppingCartIcon,
];

// Also rendered in the first HTML shell; no JavaScript is needed to animate.
// Dark to match the installed app's launch splash (manifest background_color).
export function AppStartupLoading() {
  return (
    <div
      data-app-startup-loading
      role="status"
      aria-label="Loading"
      className={styles.screen}
      style={{ backgroundColor: "#111827" }}
    >
      <div className={styles.stage} aria-hidden="true">
        <div className={styles.halo} />
        <div className={styles.ring} />
        <div className={styles.orbit}>
          {TOOLS.map((Icon, index) => (
            <span
              key={index}
              className={styles.tool}
              style={{ "--i": index } as CSSProperties}
            >
              <span className={styles.chip}>
                <Icon />
              </span>
            </span>
          ))}
        </div>
        {/* Use the exact preloaded PWA asset; no image-optimizer handoff. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/foremanhq/icon-dark-v2-512.png"
          alt=""
          width={144}
          height={144}
          className={styles.icon}
          loading="eager"
          fetchPriority="high"
          decoding="sync"
        />
      </div>
      <p className={styles.name}>{APP_NAME}</p>
      <div className={styles.bar} aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
