import Image from "next/image";
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

// Shown only while a route is actually loading, so it never delays a fast start.
// Dark to match the installed app's launch splash (manifest background_color).
export function AppStartupLoading() {
  return (
    <div
      data-app-startup-loading
      role="status"
      aria-label="Loading"
      className={styles.screen}
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
        <Image
          src="/foremanhq/icon-dark-v2-192.png"
          alt=""
          width={96}
          height={96}
          className={styles.icon}
          priority
        />
      </div>
      <p className={styles.name}>{APP_NAME}</p>
      <div className={styles.bar} aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
