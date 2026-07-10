"use client";

import { useEffect, useState } from "react";
import {
  ClipboardListIcon,
  DrillIcon,
  HammerIcon,
  HardHatIcon,
  PencilRulerIcon,
  RulerIcon,
  ShoppingCartIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

const TOOLS: Array<{ Icon: LucideIcon; className: string }> = [
  { Icon: WrenchIcon, className: "tool-1" },
  { Icon: HammerIcon, className: "tool-2" },
  { Icon: DrillIcon, className: "tool-3" },
  { Icon: RulerIcon, className: "tool-4" },
  { Icon: PencilRulerIcon, className: "tool-5" },
  { Icon: HardHatIcon, className: "tool-6" },
  { Icon: ClipboardListIcon, className: "tool-7" },
  { Icon: ShoppingCartIcon, className: "tool-8" },
];

const FAST_LOAD_HOLD_MS = 550;
const EXIT_ANIMATION_MS = 320;
const READY_EVENT = "foremenhq:app-ready";
const READY_TIMEOUT_MS = 8000;

export function AppReadySignal() {
  useEffect(() => {
    let animationFrame = 0;
    let stableFrames = 0;

    const hasVisibleAppContent = () => {
      if (document.querySelector("[data-app-startup-loading]")) return false;

      const selector = window.location.pathname.startsWith("/dashboard")
        ? "main, [role='main']"
        : "main, header, [role='main']";
      const visibleRegions = document.querySelectorAll<HTMLElement>(selector);
      return Array.from(visibleRegions).some((region) => {
        const rect = region.getBoundingClientRect();
        return (
          rect.width > 0 && rect.height >= 48 && region.childElementCount > 0
        );
      });
    };

    const checkReady = () => {
      stableFrames = hasVisibleAppContent() ? stableFrames + 1 : 0;
      if (stableFrames >= 2) {
        document.documentElement.dataset.foremenhqAppReady = "true";
        window.dispatchEvent(new Event(READY_EVENT));
        return;
      }

      animationFrame = window.requestAnimationFrame(checkReady);
    };

    animationFrame = window.requestAnimationFrame(checkReady);
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  return null;
}

export function StartupSplash() {
  const [state, setState] = useState<"holding" | "leaving" | "hidden">(
    "holding",
  );

  useEffect(() => {
    let leaveTimer: number | undefined;
    let hideTimer: number | undefined;
    let fallbackTimer: number | undefined;
    let hasStartedLeaving = false;
    const startedAt = performance.now();

    const leave = () => {
      if (hasStartedLeaving) return;
      hasStartedLeaving = true;
      if (fallbackTimer) window.clearTimeout(fallbackTimer);

      const minimumHoldMs = Math.max(
        0,
        FAST_LOAD_HOLD_MS - (performance.now() - startedAt),
      );

      leaveTimer = window.setTimeout(() => {
        setState("leaving");
        hideTimer = window.setTimeout(
          () => setState("hidden"),
          EXIT_ANIMATION_MS,
        );
      }, minimumHoldMs);
    };

    const handleReady = () => leave();

    if (document.documentElement.dataset.foremenhqAppReady === "true") {
      leave();
    } else {
      window.addEventListener(READY_EVENT, handleReady, { once: true });
      fallbackTimer = window.setTimeout(leave, READY_TIMEOUT_MS);
    }

    return () => {
      window.removeEventListener(READY_EVENT, handleReady);
      if (leaveTimer) window.clearTimeout(leaveTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };
  }, []);

  if (state === "hidden") return null;

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            #foremenhq-startup-splash {
              position: fixed;
              inset: 0;
              z-index: 2147483647;
              display: grid;
              place-items: center;
              overflow: hidden;
              background:
                radial-gradient(circle at 50% 48%, rgba(59, 130, 246, 0.26), transparent 20rem),
                radial-gradient(circle at 50% 54%, rgba(249, 115, 22, 0.16), transparent 18rem),
                linear-gradient(155deg, #020617 0%, #0f172a 48%, #111827 100%);
              color: #e5e7eb;
              pointer-events: none;
              opacity: 1;
            }

            #foremenhq-startup-splash::before,
            #foremenhq-startup-splash::after {
              position: absolute;
              content: "";
              inset: 0;
            }

            #foremenhq-startup-splash::before {
              background:
                linear-gradient(90deg, transparent 0 9%, rgba(96, 165, 250, 0.12) 9.15% 9.5%, transparent 9.65% 100%),
                linear-gradient(0deg, transparent 0 8%, rgba(148, 163, 184, 0.08) 8.1% 8.35%, transparent 8.45% 100%);
              background-size: 8rem 8rem;
              mask-image: radial-gradient(circle at 50% 50%, black, transparent 72%);
              opacity: 0.4;
              animation: foremenhq-grid-drift 2200ms linear both;
            }

            #foremenhq-startup-splash::after {
              background:
                radial-gradient(circle at 50% 50%, transparent 0 11rem, rgba(2, 6, 23, 0.52) 30rem),
                linear-gradient(rgba(255, 255, 255, 0.04) 50%, transparent 50%);
              background-size: 100% 100%, 100% 4px;
              opacity: 0.38;
              mix-blend-mode: screen;
            }

            .foremenhq-tool-stage {
              position: relative;
              width: min(82vw, 25rem);
              height: min(82vw, 25rem);
              display: grid;
              place-items: center;
              animation: foremenhq-stage-settle 2200ms cubic-bezier(0.2, 0.82, 0.2, 1) both;
            }

            .foremenhq-tool-orbit {
              position: absolute;
              inset: 0;
              border-radius: 50%;
              animation: foremenhq-orbit-spin 2200ms cubic-bezier(0.18, 0.9, 0.2, 1) both;
            }

            .foremenhq-tool-orbit::before {
              position: absolute;
              content: "";
              inset: 16%;
              border-radius: 50%;
              border: 1px solid rgba(147, 197, 253, 0.24);
              box-shadow:
                0 0 3rem rgba(59, 130, 246, 0.22),
                inset 0 0 2rem rgba(249, 115, 22, 0.14);
              opacity: 0;
              animation: foremenhq-orbit-ring 2200ms ease-out both;
            }

            .foremenhq-tool {
              --angle: 0deg;
              --burst-x: 0rem;
              --burst-y: 0rem;
              position: absolute;
              left: 50%;
              top: 50%;
              width: clamp(2.6rem, 10vw, 4.1rem);
              height: clamp(2.6rem, 10vw, 4.1rem);
              display: grid;
              place-items: center;
              border-radius: 999rem;
              color: #dbeafe;
              background:
                linear-gradient(145deg, rgba(255, 255, 255, 0.2), transparent 30%),
                linear-gradient(155deg, rgba(37, 99, 235, 0.96), rgba(15, 23, 42, 0.94));
              border: 1px solid rgba(191, 219, 254, 0.36);
              box-shadow:
                inset 0 1px rgba(255, 255, 255, 0.26),
                0 1rem 2.4rem rgba(2, 6, 23, 0.46),
                0 0 1.3rem rgba(59, 130, 246, 0.32);
              transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-8.7rem) rotate(calc(var(--angle) * -1)) scale(0.18);
              opacity: 0;
              animation: foremenhq-tool-lock 2200ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-tool svg {
              width: 58%;
              height: 58%;
              stroke-width: 2.1;
              filter: drop-shadow(0 0 0.55rem rgba(147, 197, 253, 0.42));
            }

            .foremenhq-tool.tool-1 { --angle: 0deg; --burst-x: 0rem; --burst-y: -18rem; animation-delay: 40ms; }
            .foremenhq-tool.tool-2 { --angle: 45deg; --burst-x: 14rem; --burst-y: -14rem; animation-delay: 90ms; }
            .foremenhq-tool.tool-3 { --angle: 90deg; --burst-x: 18rem; --burst-y: 0rem; animation-delay: 140ms; }
            .foremenhq-tool.tool-4 { --angle: 135deg; --burst-x: 14rem; --burst-y: 14rem; animation-delay: 190ms; }
            .foremenhq-tool.tool-5 { --angle: 180deg; --burst-x: 0rem; --burst-y: 18rem; animation-delay: 240ms; }
            .foremenhq-tool.tool-6 { --angle: 225deg; --burst-x: -14rem; --burst-y: 14rem; animation-delay: 290ms; }
            .foremenhq-tool.tool-7 { --angle: 270deg; --burst-x: -18rem; --burst-y: 0rem; animation-delay: 340ms; }
            .foremenhq-tool.tool-8 { --angle: 315deg; --burst-x: -14rem; --burst-y: -14rem; animation-delay: 390ms; }

            .foremenhq-burst-ring {
              position: absolute;
              left: 50%;
              top: 50%;
              width: 32%;
              height: 32%;
              border-radius: 999rem;
              border: 2px solid rgba(147, 197, 253, 0.78);
              transform: translate(-50%, -50%) scale(0.05);
              opacity: 0;
            }

            #foremenhq-startup-splash[data-state="leaving"] {
              animation: foremenhq-splash-reveal ${EXIT_ANIMATION_MS}ms ease-in forwards;
            }

            #foremenhq-startup-splash[data-state="leaving"] .foremenhq-tool {
              animation: foremenhq-tool-burst ${EXIT_ANIMATION_MS}ms cubic-bezier(0.12, 0.84, 0.2, 1) forwards;
            }

            #foremenhq-startup-splash[data-state="leaving"] .foremenhq-burst-ring {
              animation: foremenhq-burst-ring ${EXIT_ANIMATION_MS}ms ease-out forwards;
            }

            @keyframes foremenhq-grid-drift {
              from { background-position: 0 0; opacity: 0.18; }
              to { background-position: 0 8rem; opacity: 0.42; }
            }

            @keyframes foremenhq-stage-settle {
              0% { transform: translateY(0.9rem) scale(0.94); }
              48% { transform: translateY(-0.2rem) scale(1.04); }
              100% { transform: translateY(0) scale(1); }
            }

            @keyframes foremenhq-orbit-spin {
              0% { transform: rotate(-55deg) scale(0.72); opacity: 0; }
              32% { opacity: 1; }
              74% { transform: rotate(28deg) scale(1.02); }
              100% { transform: rotate(0deg) scale(1); opacity: 1; }
            }

            @keyframes foremenhq-orbit-ring {
              0%, 18% { opacity: 0; transform: scale(0.48); }
              42% { opacity: 0.72; transform: scale(1.06); }
              100% { opacity: 0.38; transform: scale(1); }
            }

            @keyframes foremenhq-tool-lock {
              0% {
                transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-3rem) rotate(calc(var(--angle) * -1)) scale(0.18);
                opacity: 0;
              }
              34% {
                transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-10rem) rotate(calc(var(--angle) * -1 + 18deg)) scale(1.12);
                opacity: 1;
              }
              72% {
                transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-8.7rem) rotate(calc(var(--angle) * -1)) scale(1);
                opacity: 1;
              }
              100% {
                transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-8.2rem) rotate(calc(var(--angle) * -1)) scale(1);
                opacity: 1;
              }
            }

            @keyframes foremenhq-tool-burst {
              from {
                transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-8.2rem) rotate(calc(var(--angle) * -1)) scale(1);
                opacity: 1;
              }
              to {
                transform: translate(calc(-50% + var(--burst-x)), calc(-50% + var(--burst-y))) rotate(42deg) scale(0.52);
                opacity: 0;
              }
            }

            @keyframes foremenhq-burst-ring {
              0% { transform: translate(-50%, -50%) scale(0.06); opacity: 0; }
              18% { opacity: 0.95; }
              100% { transform: translate(-50%, -50%) scale(7.5); opacity: 0; }
            }

            @keyframes foremenhq-splash-reveal {
              0% { opacity: 1; backdrop-filter: blur(0); }
              58% { opacity: 0.88; backdrop-filter: blur(2px); }
              100% { opacity: 0; visibility: hidden; backdrop-filter: blur(0); }
            }

            @media (max-width: 640px) {
              .foremenhq-tool-stage {
                width: min(88vw, 72dvh, 24rem);
                height: min(88vw, 72dvh, 24rem);
              }

              .foremenhq-tool {
                transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-36vw) rotate(calc(var(--angle) * -1)) scale(0.18);
              }

              .foremenhq-tool.tool-1 { --burst-x: 0rem; --burst-y: -14rem; }
              .foremenhq-tool.tool-2 { --burst-x: 10rem; --burst-y: -10rem; }
              .foremenhq-tool.tool-3 { --burst-x: 14rem; --burst-y: 0rem; }
              .foremenhq-tool.tool-4 { --burst-x: 10rem; --burst-y: 10rem; }
              .foremenhq-tool.tool-5 { --burst-x: 0rem; --burst-y: 14rem; }
              .foremenhq-tool.tool-6 { --burst-x: -10rem; --burst-y: 10rem; }
              .foremenhq-tool.tool-7 { --burst-x: -14rem; --burst-y: 0rem; }
              .foremenhq-tool.tool-8 { --burst-x: -10rem; --burst-y: -10rem; }
            }

            @media (prefers-reduced-motion: reduce) {
              #foremenhq-startup-splash {
                animation: foremenhq-splash-reveal 1ms linear forwards;
                background: #f9fafb;
              }

              #foremenhq-startup-splash::before,
              #foremenhq-startup-splash::after,
              .foremenhq-burst-ring {
                display: none;
              }

              .foremenhq-tool-stage {
                width: 8rem;
                height: 8rem;
                animation: none;
              }

              .foremenhq-tool {
                opacity: 1;
                animation: none;
              }
            }
          `,
        }}
      />
      <div id="foremenhq-startup-splash" data-state={state}>
        <div className="foremenhq-tool-stage" aria-hidden="true">
          <div className="foremenhq-tool-orbit">
            {TOOLS.map(({ Icon, className }) => (
              <div key={className} className={`foremenhq-tool ${className}`}>
                <Icon aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="foremenhq-burst-ring" />
        </div>
      </div>
    </>
  );
}
