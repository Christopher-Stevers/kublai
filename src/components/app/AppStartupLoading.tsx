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

// House elevation drawn line by line around the logo (stage is 200 x 200).
const BLUEPRINT_LINES = [
  "M14 160H186",
  "M40 160V62H160V160",
  "M30 66L100 18L170 66",
  "M136 42V28H149V51",
  "M40 178H160M40 172v12M160 172v12",
];

// Running-bond wall laid behind the logo, bottom course first; the longer
// courses are offset half a brick and trimmed at the ends.
const BRICK_COURSES = [4, 5, 4, 5, 4];

function indexStyle(index: number) {
  return { "--i": index } as CSSProperties;
}

// Also rendered in the first HTML shell; no JavaScript is needed to animate.
// Dark to match the installed app's launch splash (manifest background_color).
// Four scenes play around the same fixed logo; LOADER_VARIANT_SCRIPT picks one
// before first paint, and without it the orbit shows.
export function AppStartupLoading() {
  let brick = 0;
  return (
    <div
      data-app-startup-loading
      role="status"
      aria-label="Loading"
      className={styles.screen}
      style={{ backgroundColor: "#111827" }}
    >
      <div className={styles.stage} aria-hidden="true">
        <div className={`${styles.scene} ${styles.orbitScene}`}>
          <div className={styles.halo} />
          <div className={styles.ring} />
          <div className={styles.orbit}>
            {TOOLS.map((Icon, index) => (
              <span key={index} className={styles.tool} style={indexStyle(index)}>
                <span className={styles.chip}>
                  <Icon />
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className={`${styles.scene} ${styles.blueprintScene}`}>
          <svg viewBox="0 0 200 200" className={styles.drawing}>
            {BLUEPRINT_LINES.map((d, index) => (
              <path key={index} d={d} pathLength={1} style={indexStyle(index)} />
            ))}
            <text x="100" y="196" textAnchor="middle">
              12 000
            </text>
          </svg>
        </div>
        <div className={`${styles.scene} ${styles.bricksScene}`}>
          <div className={styles.wall}>
            {BRICK_COURSES.map((count, course) => (
              <div key={course} className={styles.course}>
                {Array.from({ length: count }, (_, index) => (
                  <span key={index} className={styles.brick} style={indexStyle(brick++)} />
                ))}
              </div>
            ))}
          </div>
          <HardHatIcon className={styles.hat} />
        </div>
        <div className={`${styles.scene} ${styles.levelScene}`}>
          <div className={styles.levelGlow} />
          <div className={styles.level}>
            <span className={styles.vial}>
              <span className={styles.bubble} />
            </span>
          </div>
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
