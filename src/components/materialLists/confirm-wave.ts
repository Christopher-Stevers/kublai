/**
 * The flourish for "This Information Is Correct". Green spreads from the
 * middle of the button, rebounds off both ends and wipes the button away on
 * its way back. Where the two waves meet they shoot up the card's zigzag to
 * its circle, which bursts to show the green check beneath.
 *
 * It draws on a canvas over the page, so the step dimming while it saves
 * never dulls it, and it reads the card's position every frame, so it keeps
 * up with scrolling. Nothing is left once it ends.
 */
export type WaveTargets = {
  button: HTMLElement;
  card: HTMLElement;
  circle: HTMLElement;
};

type Anchor = "button" | "card" | "circle";
type Spark = {
  anchor: Anchor;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: string;
  drag: number;
  fall: number;
};

// Out to the ends, then back to the middle.
const OUT = 380;
const BACK = 420;
const MEET = OUT + BACK;
// The two waves combine before they rise.
const GATHER = 90;
const BURST = 950;
// Every zigzag tooth of the seam is 8 px wide and 16 px tall.
const TOOTH_W = 8;
const TOOTH_H = 16;

// Sparks: pale on a dark page, deeper greens on a light one.
const NIGHT = [
  "#ecfdf5",
  "#a7f3d0",
  "#6ee7b7",
  "#34d399",
  "#d9f99d",
  "#ffffff",
];
const DAY = ["#10b981", "#34d399", "#059669", "#6ee7b7", "#65a30d", "#047857"];

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const outCubic = (u: number) => 1 - (1 - u) ** 3;
const smooth = (u: number) => u * u * (3 - 2 * u);
const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** The zigzag from the bottom of the card to its circle, as drawn by the
 * card's seam: x swings 8 px across every 16 px, starting at the left. */
function seamPath(
  card: DOMRect,
  from: { x: number; y: number },
  circle: DOMRect,
) {
  const left = card.left + card.width / 2 - TOOTH_W;
  const zig = (y: number) => {
    const m = (((y - card.top) % TOOTH_H) + TOOTH_H) % TOOTH_H;
    return left + TOOTH_W - Math.abs(m - TOOTH_W);
  };
  const points = [from, { x: zig(card.bottom), y: card.bottom }];
  for (
    let y = card.top + Math.floor((card.bottom - card.top - 1) / 8) * 8;
    y > card.top;
    y -= 8
  )
    points.push({ x: zig(y), y });
  points.push({
    x: circle.left + circle.width / 2,
    y: circle.top + circle.height / 2,
  });
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths[i - 1]! +
        Math.hypot(
          points[i]!.x - points[i - 1]!.x,
          points[i]!.y - points[i - 1]!.y,
        ),
    );
  return { points, lengths, total: lengths[lengths.length - 1]! };
}
type Path = ReturnType<typeof seamPath>;
function pointAt(path: Path, s: number) {
  const { points, lengths } = path;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i]! < s) i++;
  const a = points[i - 1]!,
    b = points[i]!,
    span = lengths[i]! - lengths[i - 1]! || 1,
    u = clamp((s - lengths[i - 1]!) / span);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

export function playConfirmWave({
  targets,
  saved,
  onCovered,
  onBurst,
  onDone,
}: {
  /** The row's button, card and circle as they are now, or null if gone. */
  targets: () => WaveTargets | null;
  /** Settles once the confirmation saved, or failed. */
  saved: Promise<boolean>;
  /** The green covers the whole button, so the real one can go. */
  onCovered: () => void;
  /** The circle bursts: show the green check now. */
  onBurst: () => void;
  onDone: (ok: boolean) => void;
}): () => void {
  let result: boolean | null = null,
    resolvedAt = Infinity,
    stopped = false;
  const start = performance.now();
  void saved.then(
    (ok) => {
      result = ok;
      resolvedAt = performance.now() - start;
    },
    () => {
      result = false;
      resolvedAt = performance.now() - start;
    },
  );

  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    onCovered();
    void saved
      .catch(() => false)
      .then((ok) => {
        if (stopped) return;
        if (ok) onBurst();
        onDone(ok);
      });
    return () => {
      stopped = true;
    };
  }

  const first = targets();
  if (!first) {
    void saved.catch(() => false).then((ok) => !stopped && onDone(ok));
    return () => {
      stopped = true;
    };
  }
  // How the button and circle look now, to redraw them in green and break.
  const look = getComputedStyle(first.button);
  const radius = parseFloat(look.borderTopLeftRadius) || 12;
  const font = `${look.fontWeight} ${look.fontSize} ${look.fontFamily}`;
  const label = first.button.textContent?.trim() ?? "";
  const was = getComputedStyle(first.circle);
  const oldFill = was.backgroundColor;
  const oldInk = was.color;
  const oldText = first.circle.textContent?.trim() ?? "";
  const circleFont = `${was.fontWeight} ${was.fontSize} ${was.fontFamily}`;
  const dark =
    document.documentElement.classList.contains("dark") ||
    (!document.documentElement.classList.contains("light") &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  const palette = dark ? NIGHT : DAY;
  // Glints and flashes: white light at night, green by day.
  const shine = dark ? "255,255,255" : "16,185,129";

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.confirmWave = "";
  Object.assign(canvas.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "60",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    onCovered();
    void saved
      .catch(() => false)
      .then((ok) => {
        if (stopped) return;
        if (ok) onBurst();
        onDone(ok);
      });
    return () => {
      stopped = true;
    };
  }

  const sparks: Spark[] = [];
  const origin = (anchor: Anchor, t: WaveTargets) => {
    const r = t[anchor].getBoundingClientRect();
    return { x: r.left, y: r.top };
  };
  const emit = (
    t: WaveTargets,
    anchor: Anchor,
    at: { x: number; y: number },
    count: number,
    shape: (i: number) => Partial<Spark>,
    now: number,
  ) => {
    const o = origin(anchor, t);
    for (let i = 0; i < count; i++)
      sparks.push({
        anchor,
        x: at.x - o.x,
        y: at.y - o.y,
        vx: 0,
        vy: 0,
        born: now,
        life: 500,
        size: 1.5,
        color: pick(palette),
        drag: 0.004,
        fall: 0,
        ...shape(i),
      });
  };

  let covered = false,
    burst = false,
    shootFrom = Infinity,
    hitAt = Infinity,
    fizzleAt = Infinity,
    impact = false,
    frame = 0,
    last = 0;
  const glow = dark ? "lighter" : "source-over";

  const finish = (ok: boolean) => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    canvas.remove();
    onDone(ok);
  };

  const draw = (now: number) => {
    if (stopped) return;
    const t = now - start;
    const dt = last ? Math.min(48, t - last) : 16;
    last = t;
    const tg = targets();
    if (!tg) {
      // The row went away: let the save finish without the show.
      canvas.remove();
      stopped = true;
      void saved.catch(() => false).then((ok) => onDone(ok));
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth,
      h = window.innerHeight;
    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const B = tg.button.getBoundingClientRect();
    const C = tg.card.getBoundingClientRect();
    const O = tg.circle.getBoundingClientRect();
    const cx = B.left + B.width / 2,
      cy = B.top + B.height / 2,
      half = B.width / 2;
    const ox = O.left + O.width / 2,
      oy = O.top + O.height / 2,
      or = O.width / 2;

    // The waves meet once both have come back and the save has answered.
    const meet = Math.max(MEET, resolvedAt);
    if (result === true && shootFrom === Infinity && t >= MEET)
      shootFrom = meet + GATHER;
    if (result === false && fizzleAt === Infinity && t >= MEET)
      fizzleAt = Math.max(MEET, t);

    // ---- The button: green out to the ends, then wiped back to the middle.
    let a = cx,
      b = cx;
    if (t < OUT) {
      const d = half * (1 - (1 - t / OUT) ** 1.7);
      a = cx - d;
      b = cx + d;
    } else if (t < MEET) {
      const d = half * smooth((t - OUT) / BACK);
      a = B.left + d;
      b = B.right - d;
    }
    if (t >= OUT && !covered) {
      covered = true;
      onCovered();
      impact = true;
    }
    if (impact) {
      impact = false;
      // Splash where each wave hits an end.
      for (const side of [-1, 1] as const)
        emit(
          tg,
          "button",
          { x: side < 0 ? B.left + 2 : B.right - 2, y: cy },
          14,
          () => {
            const angle = (side < 0 ? 0 : Math.PI) + between(-1.25, 1.25);
            const speed = between(0.08, 0.34);
            return {
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: between(260, 520),
              size: between(1, 2.2),
              drag: 0.005,
            };
          },
          t,
        );
    }
    if (t < MEET && b - a > 0.5) {
      ctx.save();
      roundRect(ctx, B.left, B.top, B.width, B.height, radius);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(a, B.top - 1, b - a, B.height + 2);
      ctx.clip();
      const fill = ctx.createLinearGradient(0, B.top, 0, B.bottom);
      fill.addColorStop(0, dark ? "#10b981" : "#34d399");
      fill.addColorStop(1, dark ? "#047857" : "#059669");
      ctx.fillStyle = fill;
      ctx.fillRect(B.left, B.top, B.width, B.height);
      // A sheen that runs with the waves.
      const sheen = ctx.createLinearGradient(B.left, B.top, B.left, B.bottom);
      sheen.addColorStop(0, "rgba(255,255,255,0.28)");
      sheen.addColorStop(0.45, "rgba(255,255,255,0.04)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(B.left, B.top, B.width, B.height / 2);
      ctx.fillStyle = "#ffffff";
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy + 0.5);
      // Ripples behind each front, always on the green side.
      for (const [x, way] of [
        [a, -1],
        [b, 1],
      ] as const) {
        for (let k = 1; k <= 3; k++) {
          const back = x - way * k * 11;
          ctx.strokeStyle = `rgba(236,253,245,${0.32 / k})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let y = B.top; y <= B.bottom; y += 2) {
            const wob = Math.sin(y / 5 + t / 45 + k) * 1.6;
            if (y === B.top) ctx.moveTo(back + wob, y);
            else ctx.lineTo(back + wob, y);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
      // The bright fronts, whose glow spills past the button.
      ctx.save();
      ctx.globalCompositeOperation = glow;
      for (const x of [a, b]) {
        // A soft band of light around a sharp white line.
        const band = ctx.createLinearGradient(x - 16, 0, x + 16, 0);
        band.addColorStop(0, "rgba(52,211,153,0)");
        band.addColorStop(0.5, "rgba(52,211,153,0.55)");
        band.addColorStop(1, "rgba(52,211,153,0)");
        ctx.fillStyle = band;
        ctx.fillRect(x - 16, B.top - 6, 32, B.height + 12);
        const core = ctx.createLinearGradient(0, B.top, 0, B.bottom);
        core.addColorStop(0, "rgba(236,253,245,0)");
        core.addColorStop(0.2, "rgba(236,253,245,0.95)");
        core.addColorStop(0.8, "rgba(236,253,245,0.95)");
        core.addColorStop(1, "rgba(236,253,245,0)");
        ctx.fillStyle = core;
        ctx.fillRect(x - 1.5, B.top + 1, 3, B.height - 2);
      }
      ctx.restore();
      // Light dust left behind as the button is wiped away.
      if (t >= OUT)
        for (const [x, way] of [
          [a, -1],
          [b, 1],
        ] as const)
          if (Math.random() < 0.9)
            emit(
              tg,
              "button",
              { x, y: between(B.top + 4, B.bottom - 4) },
              2,
              () => ({
                vx: way * between(0.02, 0.09),
                vy: between(-0.04, 0.04),
                life: between(180, 340),
                size: between(0.8, 1.6),
                drag: 0.003,
              }),
              t,
            );
    }
    // The flash and the lit border where the waves hit the ends.
    if (t >= OUT && t < OUT + 300) {
      const u = (t - OUT) / 300;
      ctx.save();
      ctx.globalCompositeOperation = glow;
      for (const x of [B.left, B.right]) {
        const g = ctx.createRadialGradient(
          x,
          cy,
          0,
          x,
          cy,
          14 + 30 * outCubic(u),
        );
        g.addColorStop(0, `rgba(236,253,245,${0.9 * (1 - u)})`);
        g.addColorStop(0.4, `rgba(52,211,153,${0.55 * (1 - u)})`);
        g.addColorStop(1, "rgba(52,211,153,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - 50, cy - 50, 100, 100);
      }
      roundRect(ctx, B.left + 1, B.top + 1, B.width - 2, B.height - 2, radius);
      for (const [width, strength] of [
        [12, 0.14],
        [6, 0.3],
        [2, 0.85],
      ] as const) {
        ctx.strokeStyle = `rgba(110,231,183,${strength * (1 - u)})`;
        ctx.lineWidth = width;
        ctx.stroke();
      }
      ctx.restore();
    }

    // ---- Where the waves meet: they gather into one bright point.
    const orb = (x: number, y: number, r: number, alpha: number) => {
      ctx.save();
      ctx.globalCompositeOperation = glow;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.22, `rgba(236,253,245,${alpha})`);
      g.addColorStop(0.5, `rgba(52,211,153,${0.6 * alpha})`);
      g.addColorStop(1, "rgba(16,185,129,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    if (t >= MEET && hitAt === Infinity) {
      const since = t - MEET;
      if (since < 260) {
        // The two fronts collide: a flash and a flare across the button line.
        const u = since / 260;
        ctx.save();
        ctx.globalCompositeOperation = glow;
        const flare = ctx.createLinearGradient(cx - 90, cy, cx + 90, cy);
        flare.addColorStop(0, "rgba(167,243,208,0)");
        flare.addColorStop(0.5, `rgba(255,255,255,${0.9 * (1 - u)})`);
        flare.addColorStop(1, "rgba(167,243,208,0)");
        ctx.fillStyle = flare;
        const reach = 30 + 70 * outCubic(u);
        ctx.fillRect(cx - reach, cy - 1, reach * 2, 2);
        ctx.restore();
        orb(cx, cy, 6 + 10 * (1 - u), 1 - u * 0.4);
      }
      if (t < shootFrom && fizzleAt === Infinity) {
        // Waiting on the save: the point pulses.
        orb(cx, cy, 6 + 1.6 * Math.sin(t / 80), 0.9);
      }
    }
    if (fizzleAt !== Infinity) {
      const u = clamp((t - fizzleAt) / 320);
      orb(cx, cy, 6 * (1 - u) + 0.1, 0.9 * (1 - u));
      if (u >= 1) return finish(false);
    }

    // ---- Up the zigzag to the circle.
    if (t >= shootFrom) {
      const path = seamPath(C, { x: cx, y: cy }, O);
      const end = Math.max(1, path.total - or * 0.7);
      const span = clamp(end / 1.5, 240, 520);
      const u = clamp((t - shootFrom) / span);
      const s = end * u ** 1.7;
      if (hitAt === Infinity && u >= 1) hitAt = t;
      // The seam stays lit where it passed, then fades. Points of about the
      // same brightness go in one stroke, so a frame costs a dozen strokes
      // however long the seam is, and no blur.
      ctx.save();
      ctx.globalCompositeOperation = glow;
      ctx.lineCap = "butt";
      ctx.lineJoin = "round";
      const step = 4;
      // Half a tooth along the seam either side lands on opposite edges, so
      // their average runs straight down the middle: the glow follows that
      // line and the sharp light follows the teeth.
      const reach = Math.hypot(TOOTH_W, TOOTH_H / 2);
      const middle = (d: number) => {
        const a = pointAt(path, clamp(d - reach / 2, 0, s)),
          b = pointAt(path, clamp(d + reach / 2, 0, s));
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      };
      type At = { x: number; y: number };
      const runs: Array<{ fade: number; near: number; points: At[] }> = [];
      const shine = (d: number) => {
        const passed = shootFrom + span * (d / end) ** (1 / 1.7);
        return {
          fade: 1 - clamp((t - passed) / 460),
          near: clamp(1 - (s - d) / 150),
        };
      };
      let lit = s;
      for (let d = 0; d < s; d += step) {
        const { fade: f, near: n } = shine(d);
        const fade = Math.ceil(6 * f) / 6,
          near = Math.ceil(5 * n) / 5;
        if (fade <= 0 && near <= 0) continue;
        lit = Math.min(lit, d);
        const run = runs.at(-1),
          next = pointAt(path, Math.min(s, d + step));
        if (run?.fade === fade && run.near === near) run.points.push(next);
        else runs.push({ fade, near, points: [pointAt(path, d), next] });
      }
      // The glow: one soft stroke up the middle of the seam, brightest at
      // the head and fading where the light has passed.
      if (s - lit > 2) {
        const from = middle(lit),
          to = middle(s);
        const rise = from.y - to.y;
        if (rise > 2) {
          const fill = ctx.createLinearGradient(0, from.y, 0, to.y);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          for (let d = lit; ; d = Math.min(s, d + 8)) {
            const at = middle(d),
              { fade, near } = shine(d);
            ctx.lineTo(at.x, at.y);
            fill.addColorStop(
              clamp((from.y - at.y) / rise),
              `rgba(52,211,153,${clamp(0.32 * fade + 0.5 * near)})`,
            );
            if (d >= s) break;
          }
          ctx.strokeStyle = fill;
          ctx.lineWidth = TOOTH_W;
          ctx.shadowColor = "rgba(16,185,129,0.9)";
          ctx.shadowBlur = 14;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
      // The light itself, sharp along the teeth.
      for (const { fade, near, points } of runs) {
        ctx.beginPath();
        points.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.strokeStyle = `rgba(52,211,153,${Math.min(1, 0.45 * fade + 0.35 * near)})`;
        ctx.lineWidth = 2 + 5 * near;
        ctx.stroke();
        if (near > 0) {
          ctx.strokeStyle = `rgba(240,253,244,${0.95 * near})`;
          ctx.lineWidth = 1.6 + 1.4 * near;
          ctx.stroke();
        }
      }
      ctx.restore();
      if (hitAt === Infinity) {
        const head = pointAt(path, s);
        orb(head.x, head.y, 5.5, 1);
        emit(
          tg,
          "card",
          head,
          2,
          () => {
            const angle = between(0, Math.PI * 2);
            const speed = between(0.02, 0.12);
            return {
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed + 0.03,
              life: between(220, 420),
              size: between(0.8, 1.8),
              drag: 0.004,
            };
          },
          t,
        );
      }
    }

    // ---- The burst at the circle.
    if (t >= hitAt) {
      const since = t - hitAt;
      if (!burst) {
        burst = true;
        onBurst();
        tg.circle.animate?.(
          [
            { transform: "scale(0.35)", filter: "brightness(1.8)" },
            {
              transform: "scale(1.2)",
              filter: "brightness(1.25)",
              offset: 0.55,
            },
            { transform: "scale(0.96)", offset: 0.8 },
            { transform: "scale(1)", filter: "brightness(1)" },
          ],
          { duration: 620, easing: "cubic-bezier(.2,.8,.3,1)" },
        );
        emit(
          tg,
          "circle",
          { x: ox, y: oy },
          38,
          () => {
            const angle = between(0, Math.PI * 2);
            const speed = between(0.14, 0.52);
            return {
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: between(420, 880),
              size: between(1.2, 2.6),
              drag: 0.0032,
              fall: 0.00018,
            };
          },
          t,
        );
      }
      ctx.save();
      // The old circle breaks into shards that fly off and fade.
      const shardU = clamp(since / 420);
      if (shardU < 1) {
        const pieces = 12;
        const p = outCubic(shardU);
        for (let i = 0; i < pieces; i++) {
          const mid = (i / pieces) * Math.PI * 2 + 0.3;
          const seed = Math.sin(i * 12.9898) * 43758.5453;
          const r1 = seed - Math.floor(seed);
          const away = p * (30 + 22 * r1);
          ctx.save();
          ctx.globalAlpha = 1 - shardU;
          ctx.translate(ox + Math.cos(mid) * away, oy + Math.sin(mid) * away);
          ctx.rotate(p * (r1 - 0.5) * 2.6);
          ctx.scale(1 - 0.45 * p, 1 - 0.45 * p);
          ctx.fillStyle = oldFill;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, or, mid - Math.PI / pieces, mid + Math.PI / pieces);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        if (since < 70 && oldText) {
          ctx.globalAlpha = 1 - since / 70;
          ctx.fillStyle = oldInk;
          ctx.font = circleFont;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(oldText, ox, oy);
          ctx.globalAlpha = 1;
        }
      }
      ctx.globalCompositeOperation = glow;
      // A white flash.
      if (since < 180) {
        const u = since / 180;
        const g = ctx.createRadialGradient(
          ox,
          oy,
          0,
          ox,
          oy,
          or * (0.9 + 1.4 * u),
        );
        g.addColorStop(0, `rgba(${shine},${0.95 * (1 - u)})`);
        g.addColorStop(0.6, `rgba(209,250,229,${0.6 * (1 - u)})`);
        g.addColorStop(1, "rgba(209,250,229,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ox, oy, or * (0.9 + 1.4 * u), 0, Math.PI * 2);
        ctx.fill();
      }
      // Two shockwave rings.
      for (const [delay, reach, color, width] of [
        [0, 64, "52,211,153", 3.5],
        [90, 42, "167,243,208", 2.5],
      ] as const) {
        const u = clamp((since - delay) / 560);
        if (u <= 0 || u >= 1) continue;
        const line = width * (1 - u) + 0.5;
        ctx.beginPath();
        ctx.arc(ox, oy, or + reach * outCubic(u), 0, Math.PI * 2);
        // A wide faint ring under a sharp one reads as glow, without a blur.
        for (const [grow, strength] of [
          [line * 3 + 8, 0.18],
          [line * 1.8 + 3, 0.3],
          [line, 0.9],
        ] as const) {
          ctx.strokeStyle = `rgba(${color},${strength * (1 - u)})`;
          ctx.lineWidth = grow;
          ctx.stroke();
        }
      }
      // A soft halo around the new check.
      {
        const u = clamp(since / 760);
        if (u < 1) {
          const g = ctx.createRadialGradient(
            ox,
            oy,
            or * 0.8,
            ox,
            oy,
            or + 30 * outCubic(u),
          );
          g.addColorStop(0, `rgba(16,185,129,${0.5 * (1 - u)})`);
          g.addColorStop(1, "rgba(16,185,129,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(ox, oy, or + 30 * outCubic(u), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Glints that twinkle around it.
      for (let i = 0; i < 6; i++) {
        const u = clamp((since - 80 - i * 55) / 300);
        if (u <= 0 || u >= 1) continue;
        const angle = i * 1.9 + 0.6,
          dist = or + 16 + (i % 3) * 9;
        const x = ox + Math.cos(angle) * dist,
          y = oy + Math.sin(angle) * dist;
        const size = 6 * Math.sin(u * Math.PI);
        ctx.fillStyle = `rgba(${shine},${0.95 * Math.sin(u * Math.PI)})`;
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.quadraticCurveTo(x, y, x + size, y);
        ctx.quadraticCurveTo(x, y, x, y + size);
        ctx.quadraticCurveTo(x, y, x - size, y);
        ctx.quadraticCurveTo(x, y, x, y - size);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- Sparks, drawn as short streaks.
    ctx.save();
    ctx.globalCompositeOperation = glow;
    ctx.lineCap = "round";
    const at = {
      button: origin("button", tg),
      card: origin("card", tg),
      circle: origin("circle", tg),
    };
    for (let i = sparks.length - 1; i >= 0; i--) {
      const sp = sparks[i]!;
      const age = t - sp.born;
      if (age >= sp.life) {
        sparks.splice(i, 1);
        continue;
      }
      const keep = Math.exp(-sp.drag * dt);
      sp.vx *= keep;
      sp.vy = sp.vy * keep + sp.fall * dt;
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      const o = at[sp.anchor];
      const x = o.x + sp.x,
        y = o.y + sp.y;
      const fade = 1 - age / sp.life;
      ctx.strokeStyle = sp.color;
      ctx.globalAlpha = fade;
      ctx.lineWidth = sp.size * (0.6 + 0.4 * fade);
      ctx.beginPath();
      ctx.moveTo(x - sp.vx * 14, y - sp.vy * 14);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();

    if (t >= hitAt + BURST && !sparks.length) return finish(true);
    if (t >= hitAt + BURST + 400) return finish(true);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    canvas.remove();
  };
}
