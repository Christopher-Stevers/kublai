"use client";

import { useEffect, useState } from "react";

export function StartupSplash() {
  const [state, setState] = useState<"holding" | "leaving" | "hidden">(
    "holding",
  );

  useEffect(() => {
    let leaveTimer: number | undefined;
    let hideTimer: number | undefined;
    const startedAt = performance.now();

    const leave = () => {
      const minimumHoldMs = Math.max(0, 2450 - (performance.now() - startedAt));

      leaveTimer = window.setTimeout(() => {
        setState("leaving");
        hideTimer = window.setTimeout(() => setState("hidden"), 420);
      }, minimumHoldMs);
    };

    if (document.readyState === "complete") {
      leave();
    } else {
      window.addEventListener("load", leave, { once: true });
    }

    return () => {
      window.removeEventListener("load", leave);
      if (leaveTimer) window.clearTimeout(leaveTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
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
                radial-gradient(circle at 50% 45%, rgba(59, 130, 246, 0.26), transparent 22rem),
                radial-gradient(circle at 50% 72%, rgba(249, 115, 22, 0.2), transparent 18rem),
                linear-gradient(160deg, #020617 0%, #0f172a 42%, #111827 100%);
              color: #e5e7eb;
              pointer-events: none;
              opacity: 1;
              perspective: 900px;
              animation: foremenhq-camera-crane 2450ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
            }

            #foremenhq-startup-splash::before,
            #foremenhq-startup-splash::after {
              position: absolute;
              content: "";
              inset: 0;
            }

            #foremenhq-startup-splash::before {
              background:
                linear-gradient(90deg, transparent 0 9%, rgba(96, 165, 250, 0.13) 9.15% 9.5%, transparent 9.65% 100%),
                linear-gradient(0deg, transparent 0 8%, rgba(148, 163, 184, 0.08) 8.1% 8.35%, transparent 8.45% 100%);
              background-size: 8.5rem 8.5rem;
              mask-image: radial-gradient(circle at 50% 50%, black, transparent 72%);
              transform: translate3d(0, 0, -160px) rotateX(60deg) scale(1.7);
              opacity: 0.45;
              animation: foremenhq-grid-push 2450ms linear both;
            }

            #foremenhq-startup-splash::after {
              background:
                linear-gradient(rgba(255, 255, 255, 0.045) 50%, transparent 50%),
                radial-gradient(circle at 50% 54%, transparent 0 12rem, rgba(2, 6, 23, 0.56) 32rem);
              background-size: 100% 4px, 100% 100%;
              mix-blend-mode: screen;
              opacity: 0.42;
            }

            .foremenhq-bay {
              position: relative;
              width: min(116vw, 42rem);
              height: min(116vw, 42rem);
              margin-top: -6vh;
              transform-style: preserve-3d;
              animation: foremenhq-bay-drop 2450ms cubic-bezier(0.18, 0.92, 0.18, 1) both;
            }

            .foremenhq-bay-glow {
              position: absolute;
              inset: 14%;
              border-radius: 999rem;
              background:
                radial-gradient(circle, rgba(96, 165, 250, 0.35), transparent 58%),
                conic-gradient(from 170deg, transparent, rgba(249, 115, 22, 0.32), transparent, rgba(59, 130, 246, 0.3), transparent);
              filter: blur(18px);
              opacity: 0;
              animation: foremenhq-reactor-glow 2450ms ease-out both;
            }

            .foremenhq-transformer {
              position: absolute;
              inset: 0;
              transform-style: preserve-3d;
              filter: drop-shadow(0 2rem 2.8rem rgba(0, 0, 0, 0.55));
              animation: foremenhq-machine-rise 2450ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
            }

            .foremenhq-part {
              position: absolute;
              background:
                linear-gradient(135deg, rgba(255, 255, 255, 0.36), transparent 28%),
                linear-gradient(160deg, #2563eb 0%, #1d4ed8 45%, #111827 100%);
              border: 1px solid rgba(191, 219, 254, 0.34);
              box-shadow:
                inset 0 1px rgba(255, 255, 255, 0.34),
                inset 0 -0.6rem 1.1rem rgba(2, 6, 23, 0.34),
                0 1.2rem 2.6rem rgba(2, 6, 23, 0.42);
              transform-style: preserve-3d;
            }

            .foremenhq-truck-cab {
              left: 23%;
              top: 46%;
              width: 54%;
              height: 21%;
              border-radius: 1rem 1.7rem 0.55rem 0.55rem;
              transform-origin: 50% 100%;
              animation: foremenhq-cab-transform 2450ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-windshield {
              position: absolute;
              left: 47%;
              top: 13%;
              width: 31%;
              height: 34%;
              border-radius: 0.45rem 1rem 0.2rem 0.25rem;
              background: linear-gradient(135deg, rgba(191, 219, 254, 0.92), rgba(14, 165, 233, 0.35));
              box-shadow: 0 0 1.4rem rgba(96, 165, 250, 0.6);
              transform: skewX(18deg);
              animation: foremenhq-window-split 2450ms ease-out both;
            }

            .foremenhq-grille {
              position: absolute;
              left: 11%;
              top: 54%;
              width: 78%;
              height: 26%;
              border-radius: 0.3rem;
              background: repeating-linear-gradient(90deg, #d1d5db 0 0.3rem, #64748b 0.3rem 0.55rem);
              box-shadow: 0 0 1rem rgba(226, 232, 240, 0.45);
              animation: foremenhq-grille-lock 2450ms ease-out both;
            }

            .foremenhq-chest {
              left: 32%;
              top: 35%;
              width: 36%;
              height: 30%;
              border-radius: 0.8rem 0.8rem 0.45rem 0.45rem;
              transform-origin: 50% 100%;
              animation: foremenhq-chest-lock 2450ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-logo-core {
              position: absolute;
              left: 50%;
              top: 53%;
              width: 24%;
              height: 24%;
              display: grid;
              place-items: center;
              border-radius: 0.7rem;
              background: rgba(15, 23, 42, 0.76);
              border: 1px solid rgba(147, 197, 253, 0.45);
              box-shadow: 0 0 2rem rgba(59, 130, 246, 0.72);
              transform: translate(-50%, -50%) scale(0.25) rotateY(80deg);
              opacity: 0;
              animation: foremenhq-core-reveal 2450ms cubic-bezier(0.2, 0.88, 0.2, 1) both;
            }

            .foremenhq-logo-core img {
              width: 74%;
              height: 74%;
              border-radius: 0.45rem;
              filter: drop-shadow(0 0 0.8rem rgba(96, 165, 250, 0.75));
            }

            .foremenhq-head {
              left: 41.5%;
              top: 24%;
              width: 17%;
              height: 15%;
              border-radius: 0.38rem 0.38rem 0.55rem 0.55rem;
              background:
                linear-gradient(90deg, transparent 0 16%, rgba(239, 68, 68, 0.85) 16% 26%, transparent 26% 74%, rgba(239, 68, 68, 0.85) 74% 84%, transparent 84%),
                linear-gradient(160deg, #cbd5e1 0%, #475569 36%, #111827 100%);
              transform-origin: 50% 100%;
              animation: foremenhq-head-rise 2450ms cubic-bezier(0.18, 1, 0.2, 1) both;
            }

            .foremenhq-antenna {
              position: absolute;
              left: 49.3%;
              top: 17%;
              width: 0.4rem;
              height: 3.2rem;
              border-radius: 999rem;
              background: linear-gradient(#f97316, #93c5fd);
              box-shadow: 0 0 1.2rem rgba(249, 115, 22, 0.8);
              transform: scaleY(0);
              transform-origin: 50% 100%;
              animation: foremenhq-antenna-snap 2450ms ease-out both;
            }

            .foremenhq-shoulder {
              top: 39%;
              width: 23%;
              height: 16%;
              border-radius: 0.65rem;
              background:
                linear-gradient(135deg, rgba(255, 255, 255, 0.25), transparent 30%),
                linear-gradient(160deg, #f97316 0%, #dc2626 44%, #111827 100%);
            }

            .foremenhq-shoulder.left {
              left: 18%;
              transform-origin: 100% 50%;
              animation: foremenhq-left-shoulder 2450ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-shoulder.right {
              right: 18%;
              transform-origin: 0 50%;
              animation: foremenhq-right-shoulder 2450ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-arm {
              top: 53%;
              width: 13%;
              height: 28%;
              border-radius: 0.65rem;
              background:
                repeating-linear-gradient(0deg, transparent 0 0.85rem, rgba(255, 255, 255, 0.14) 0.85rem 1rem),
                linear-gradient(160deg, #334155 0%, #0f172a 100%);
            }

            .foremenhq-arm.left {
              left: 17%;
              transform-origin: 50% 0;
              animation: foremenhq-left-arm 2450ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-arm.right {
              right: 17%;
              transform-origin: 50% 0;
              animation: foremenhq-right-arm 2450ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-leg {
              bottom: 7%;
              width: 14%;
              height: 28%;
              border-radius: 0.55rem 0.55rem 0.9rem 0.9rem;
              background:
                linear-gradient(90deg, transparent 0 42%, rgba(147, 197, 253, 0.32) 42% 58%, transparent 58%),
                linear-gradient(160deg, #1d4ed8 0%, #111827 100%);
            }

            .foremenhq-leg.left {
              left: 34%;
              transform-origin: 50% 0;
              animation: foremenhq-left-leg 2450ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-leg.right {
              right: 34%;
              transform-origin: 50% 0;
              animation: foremenhq-right-leg 2450ms cubic-bezier(0.18, 0.95, 0.17, 1) both;
            }

            .foremenhq-wheel {
              position: absolute;
              width: 18%;
              height: 18%;
              border-radius: 50%;
              background:
                radial-gradient(circle, #94a3b8 0 18%, #020617 19% 44%, #111827 45% 60%, #020617 61% 100%);
              border: 0.45rem solid #111827;
              box-shadow:
                inset 0 0 0 0.25rem rgba(148, 163, 184, 0.55),
                0 0.8rem 1.8rem rgba(0, 0, 0, 0.54);
            }

            .foremenhq-wheel.front {
              left: 19%;
              top: 58%;
              animation: foremenhq-front-wheel 2450ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
            }

            .foremenhq-wheel.rear {
              right: 19%;
              top: 58%;
              animation: foremenhq-rear-wheel 2450ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
            }

            .foremenhq-piston {
              position: absolute;
              left: 49%;
              top: 36%;
              width: 2%;
              height: 43%;
              border-radius: 999rem;
              background: linear-gradient(#e2e8f0, #64748b 45%, #0f172a);
              box-shadow: 0 0 1rem rgba(226, 232, 240, 0.38);
              transform-origin: 50% 50%;
              opacity: 0;
            }

            .foremenhq-piston.p1 {
              transform: rotate(34deg);
              animation: foremenhq-piston-flash 2450ms 620ms ease-out both;
            }

            .foremenhq-piston.p2 {
              transform: rotate(-34deg);
              animation: foremenhq-piston-flash 2450ms 720ms ease-out both;
            }

            .foremenhq-spark {
              position: absolute;
              left: 50%;
              top: 50%;
              width: 0.35rem;
              height: 0.35rem;
              border-radius: 50%;
              background: #fbbf24;
              box-shadow: 0 0 1.2rem #f97316;
              opacity: 0;
            }

            .foremenhq-spark.s1 { animation: foremenhq-spark-1 2450ms linear both; }
            .foremenhq-spark.s2 { animation: foremenhq-spark-2 2450ms linear both; }
            .foremenhq-spark.s3 { animation: foremenhq-spark-3 2450ms linear both; }
            .foremenhq-spark.s4 { animation: foremenhq-spark-4 2450ms linear both; }

            .foremenhq-impact-ring {
              position: absolute;
              left: 50%;
              top: 52%;
              width: 16%;
              height: 16%;
              border-radius: 50%;
              border: 2px solid rgba(147, 197, 253, 0.78);
              transform: translate(-50%, -50%) scale(0.1);
              opacity: 0;
              animation: foremenhq-impact-ring 2450ms ease-out both;
            }

            #foremenhq-startup-splash[data-state="leaving"] {
              animation: foremenhq-splash-fade-out 420ms ease-in forwards;
            }

            @keyframes foremenhq-camera-crane {
              0% { transform: scale(1.08); filter: contrast(1.08) saturate(1.08); }
              18% { transform: scale(1.04) translateY(0.6rem); }
              43% { transform: scale(1.01) translateY(-0.2rem) rotate(0deg); }
              48% { transform: scale(1.035) translateX(-0.16rem) rotate(-0.35deg); }
              52% { transform: scale(1.02) translateX(0.16rem) rotate(0.35deg); }
              65% { transform: scale(1.005) translateY(-0.4rem); }
              100% { transform: scale(1); filter: contrast(1.18) saturate(1.18); }
            }

            @keyframes foremenhq-grid-push {
              from { background-position: 0 0; opacity: 0.22; }
              to { background-position: 0 9rem; opacity: 0.48; }
            }

            @keyframes foremenhq-bay-drop {
              0% { transform: rotateX(64deg) rotateZ(-9deg) scale(0.96); opacity: 0; }
              18% { transform: rotateX(26deg) rotateZ(-3deg) scale(1.16); opacity: 1; }
              48% { transform: rotateX(12deg) rotateZ(1deg) scale(1.2); }
              70% { transform: rotateX(0deg) rotateZ(0deg) scale(1.12); }
              100% { transform: rotateX(0deg) rotateZ(0deg) scale(1.08); opacity: 1; }
            }

            @keyframes foremenhq-reactor-glow {
              0%, 18% { opacity: 0; transform: scale(0.4) rotate(0deg); }
              43% { opacity: 0.7; transform: scale(0.95) rotate(120deg); }
              70% { opacity: 1; transform: scale(1.24) rotate(260deg); }
              100% { opacity: 0.58; transform: scale(1.08) rotate(360deg); }
            }

            @keyframes foremenhq-machine-rise {
              0% { transform: translateY(2.2rem) rotateX(18deg) scale(0.94); }
              32% { transform: translateY(0.7rem) rotateX(10deg) scale(1.06); }
              58% { transform: translateY(-0.65rem) rotateX(-3deg) scale(1.14); }
              76% { transform: translateY(0) rotateX(0deg) scale(1.08); }
              100% { transform: translateY(0) rotateX(0deg) scale(1.08); }
            }

            @keyframes foremenhq-cab-transform {
              0%, 24% { transform: translateY(3%) rotateX(0deg) scaleX(1); opacity: 1; }
              42% { transform: translateY(-20%) rotateX(-68deg) scaleX(0.92); opacity: 0.95; }
              60%, 100% { transform: translateY(-43%) rotateX(-83deg) scaleX(0.72); opacity: 0; }
            }

            @keyframes foremenhq-window-split {
              0%, 32% { transform: skewX(18deg) translateX(0); opacity: 1; }
              52% { transform: skewX(-8deg) translateX(-60%) rotate(-18deg); opacity: 0.85; }
              72%, 100% { transform: skewX(-8deg) translateX(-95%) rotate(-26deg); opacity: 0; }
            }

            @keyframes foremenhq-grille-lock {
              0%, 34% { transform: translateY(0) scaleX(1); opacity: 0.9; }
              54% { transform: translateY(-124%) scaleX(0.78) rotateX(72deg); opacity: 1; }
              70%, 100% { transform: translateY(-156%) scaleX(0.5) rotateX(84deg); opacity: 0; }
            }

            @keyframes foremenhq-chest-lock {
              0%, 22% { transform: translateY(36%) scale(0.24, 0.16) rotateX(76deg); opacity: 0; }
              42% { transform: translateY(12%) scale(0.9, 0.72) rotateX(28deg); opacity: 1; }
              58% { transform: translateY(-2%) scale(1.08, 1.06) rotateX(-8deg); }
              70%, 100% { transform: translateY(0) scale(1) rotateX(0deg); opacity: 1; }
            }

            @keyframes foremenhq-core-reveal {
              0%, 44% { transform: translate(-50%, -50%) scale(0.22) rotateY(80deg); opacity: 0; }
              60% { transform: translate(-50%, -50%) scale(1.16) rotateY(-14deg); opacity: 1; }
              74%, 100% { transform: translate(-50%, -50%) scale(1) rotateY(0deg); opacity: 1; }
            }

            @keyframes foremenhq-head-rise {
              0%, 42% { transform: translateY(180%) scale(0.6) rotateX(82deg); opacity: 0; }
              58% { transform: translateY(-14%) scale(1.12) rotateX(-12deg); opacity: 1; }
              72%, 100% { transform: translateY(0) scale(1) rotateX(0deg); opacity: 1; }
            }

            @keyframes foremenhq-antenna-snap {
              0%, 64% { transform: scaleY(0); opacity: 0; }
              72% { transform: scaleY(1.25); opacity: 1; }
              82%, 100% { transform: scaleY(1); opacity: 1; }
            }

            @keyframes foremenhq-left-shoulder {
              0%, 20% { transform: translate(88%, 32%) rotateZ(0deg) rotateY(0deg); opacity: 0; }
              44% { transform: translate(34%, -2%) rotateZ(-32deg) rotateY(58deg); opacity: 1; }
              66%, 100% { transform: translate(0, 0) rotateZ(-13deg) rotateY(0deg); opacity: 1; }
            }

            @keyframes foremenhq-right-shoulder {
              0%, 20% { transform: translate(-88%, 32%) rotateZ(0deg) rotateY(0deg); opacity: 0; }
              44% { transform: translate(-34%, -2%) rotateZ(32deg) rotateY(-58deg); opacity: 1; }
              66%, 100% { transform: translate(0, 0) rotateZ(13deg) rotateY(0deg); opacity: 1; }
            }

            @keyframes foremenhq-left-arm {
              0%, 36% { transform: translate(220%, -52%) rotateZ(88deg) scaleY(0.35); opacity: 0; }
              55% { transform: translate(38%, -4%) rotateZ(-44deg) scaleY(1.08); opacity: 1; }
              72%, 100% { transform: translate(0, 0) rotateZ(9deg) scaleY(1); opacity: 1; }
            }

            @keyframes foremenhq-right-arm {
              0%, 36% { transform: translate(-220%, -52%) rotateZ(-88deg) scaleY(0.35); opacity: 0; }
              55% { transform: translate(-38%, -4%) rotateZ(44deg) scaleY(1.08); opacity: 1; }
              72%, 100% { transform: translate(0, 0) rotateZ(-9deg) scaleY(1); opacity: 1; }
            }

            @keyframes foremenhq-left-leg {
              0%, 24% { transform: translate(92%, -50%) rotateZ(92deg) scaleY(0.45); opacity: 0; }
              54% { transform: translate(22%, -8%) rotateZ(18deg) scaleY(1.18); opacity: 1; }
              72%, 100% { transform: translate(0, 0) rotateZ(3deg) scaleY(1); opacity: 1; }
            }

            @keyframes foremenhq-right-leg {
              0%, 24% { transform: translate(-92%, -50%) rotateZ(-92deg) scaleY(0.45); opacity: 0; }
              54% { transform: translate(-22%, -8%) rotateZ(-18deg) scaleY(1.18); opacity: 1; }
              72%, 100% { transform: translate(0, 0) rotateZ(-3deg) scaleY(1); opacity: 1; }
            }

            @keyframes foremenhq-front-wheel {
              0%, 18% { transform: translate(0, 0) rotate(0deg) scale(1); }
              42% { transform: translate(62%, -82%) rotate(680deg) scale(0.82); }
              64%, 100% { transform: translate(32%, -132%) rotate(950deg) scale(0.45); opacity: 0.85; }
            }

            @keyframes foremenhq-rear-wheel {
              0%, 18% { transform: translate(0, 0) rotate(0deg) scale(1); }
              42% { transform: translate(-62%, -82%) rotate(-680deg) scale(0.82); }
              64%, 100% { transform: translate(-32%, -132%) rotate(-950deg) scale(0.45); opacity: 0.85; }
            }

            @keyframes foremenhq-piston-flash {
              0%, 18% { opacity: 0; scale: 0.1 0.2; }
              31%, 58% { opacity: 0.9; scale: 1 1; }
              74%, 100% { opacity: 0.24; scale: 1 0.72; }
            }

            @keyframes foremenhq-spark-1 {
              0%, 38% { transform: translate(0, 0) scale(0); opacity: 0; }
              46% { transform: translate(-7rem, -5rem) scale(1); opacity: 1; }
              62%, 100% { transform: translate(-12rem, -8rem) scale(0); opacity: 0; }
            }

            @keyframes foremenhq-spark-2 {
              0%, 42% { transform: translate(0, 0) scale(0); opacity: 0; }
              50% { transform: translate(7rem, -4.5rem) scale(1); opacity: 1; }
              66%, 100% { transform: translate(13rem, -8rem) scale(0); opacity: 0; }
            }

            @keyframes foremenhq-spark-3 {
              0%, 52% { transform: translate(0, 0) scale(0); opacity: 0; }
              59% { transform: translate(-6rem, 6rem) scale(1); opacity: 1; }
              75%, 100% { transform: translate(-11rem, 10rem) scale(0); opacity: 0; }
            }

            @keyframes foremenhq-spark-4 {
              0%, 55% { transform: translate(0, 0) scale(0); opacity: 0; }
              62% { transform: translate(6.5rem, 5rem) scale(1); opacity: 1; }
              80%, 100% { transform: translate(12rem, 8.5rem) scale(0); opacity: 0; }
            }

            @keyframes foremenhq-impact-ring {
              0%, 57% { transform: translate(-50%, -50%) scale(0.1); opacity: 0; }
              64% { opacity: 0.9; }
              83%, 100% { transform: translate(-50%, -50%) scale(4.8); opacity: 0; }
            }

            @keyframes foremenhq-splash-fade-out {
              from { opacity: 1; transform: scale(1); }
              to { opacity: 0; transform: scale(1.08); visibility: hidden; }
            }

            @media (prefers-reduced-motion: reduce) {
              #foremenhq-startup-splash {
                animation: foremenhq-splash-fade-out 1ms linear forwards;
                background: #f9fafb;
              }

              #foremenhq-startup-splash::before,
              #foremenhq-startup-splash::after,
              .foremenhq-bay-glow,
              .foremenhq-transformer > :not(.foremenhq-logo-core) {
                display: none;
              }

              .foremenhq-bay {
                width: min(30vw, 8rem);
                height: min(30vw, 8rem);
                min-width: 6.5rem;
                min-height: 6.5rem;
                animation: none;
              }

              .foremenhq-logo-core {
                inset: 0;
                width: 100%;
                height: 100%;
                transform: none;
                opacity: 1;
                border-radius: 1.75rem;
                background: transparent;
                border: 0;
                box-shadow: 0 24px 70px rgba(15, 23, 42, 0.16);
                animation: none;
              }

              .foremenhq-logo-core img {
                width: 100%;
                height: 100%;
                border-radius: 1.75rem;
              }
            }
          `,
        }}
      />
      <div id="foremenhq-startup-splash" data-state={state}>
        <div className="foremenhq-bay" aria-hidden="true">
          <div className="foremenhq-bay-glow" />
          <div className="foremenhq-transformer">
            <div className="foremenhq-part foremenhq-truck-cab">
              <div className="foremenhq-windshield" />
              <div className="foremenhq-grille" />
            </div>
            <div className="foremenhq-part foremenhq-chest" />
            <div className="foremenhq-part foremenhq-shoulder left" />
            <div className="foremenhq-part foremenhq-shoulder right" />
            <div className="foremenhq-part foremenhq-arm left" />
            <div className="foremenhq-part foremenhq-arm right" />
            <div className="foremenhq-part foremenhq-leg left" />
            <div className="foremenhq-part foremenhq-leg right" />
            <div className="foremenhq-part foremenhq-head" />
            <div className="foremenhq-antenna" />
            <div className="foremenhq-wheel front" />
            <div className="foremenhq-wheel rear" />
            <div className="foremenhq-piston p1" />
            <div className="foremenhq-piston p2" />
            <div className="foremenhq-spark s1" />
            <div className="foremenhq-spark s2" />
            <div className="foremenhq-spark s3" />
            <div className="foremenhq-spark s4" />
            <div className="foremenhq-impact-ring" />
            <div className="foremenhq-logo-core">
              <img
                src="/foremanhq/android-chrome-192x192.png"
                alt=""
                width="128"
                height="128"
                decoding="async"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
