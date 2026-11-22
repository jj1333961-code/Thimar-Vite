import { useEffect, useRef, useState } from "react";
import {
  CELEBRATE_EVENT,
  playCelebrationSound,
  type CelebrationKind,
} from "../lib/celebrate";

type Paper = {
  kind: "paper";
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  sway: number;
  phase: number;
};

type Star = {
  kind: "star";
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vr: number;
  color: string;
  phase: number;
};

type Balloon = {
  kind: "balloon";
  x: number;
  y: number;
  r: number;
  vy: number;
  color: string;
  phase: number;
};

type Particle = Paper | Star | Balloon;

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
};

type Burst = { x: number; y: number; at: number; sparks: Spark[] };

const COLORS = [
  "#2F5C4A",
  "#D8B25A",
  "#ef4444",
  "#3b82f6",
  "#a855f7",
  "#f97316",
  "#10b981",
  "#ec4899",
  "#facc15",
  "#06b6d4",
];

const DURATION = 4600;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function starPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 === 0 ? r : r * 0.46;
    const angle = (Math.PI / 5) * point - Math.PI / 2;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    if (point === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * طبقة الاحتفال: ورق ملوّن بأحجام مختلفة، نجوم ملوّنة، بالونات،
 * وألعاب نارية صغيرة — كلها بمقاس متناسب مع الشاشة وتُحرَّك بالرسوم.
 */
export default function Celebration() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [runId, setRunId] = useState(0);
  const [visible, setVisible] = useState(false);
  const [kind, setKind] = useState<CelebrationKind>("register");

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: CelebrationKind }>).detail;
      setKind(detail?.kind ?? "register");
      setVisible(true);
      setRunId((value) => value + 1);
      playCelebrationSound();
    };
    window.addEventListener(CELEBRATE_EVENT, handler);
    return () => window.removeEventListener(CELEBRATE_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const unit = Math.min(width, height);
    const reduced = document.documentElement.dataset.motion === "reduced";
    const paperCount = reduced ? 46 : 96;
    const starCount = reduced ? 9 : 18;
    const balloonCount = reduced ? 3 : 6;

    const particles: Particle[] = [];

    for (let i = 0; i < paperCount; i += 1) {
      const w = rand(unit * 0.012, unit * 0.03);
      particles.push({
        kind: "paper",
        x: rand(0, width),
        y: rand(-height * 0.5, -unit * 0.02),
        vx: rand(-24, 24),
        vy: rand(unit * 0.12, unit * 0.3),
        w,
        h: w * rand(0.5, 1.4),
        rot: rand(0, Math.PI * 2),
        vr: rand(-5, 5),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        sway: rand(12, 42),
        phase: rand(0, Math.PI * 2),
      });
    }

    for (let i = 0; i < starCount; i += 1) {
      particles.push({
        kind: "star",
        x: rand(0, width),
        y: rand(-height * 0.4, -unit * 0.02),
        vx: rand(-30, 30),
        vy: rand(unit * 0.1, unit * 0.22),
        r: rand(unit * 0.009, unit * 0.022),
        rot: rand(0, Math.PI * 2),
        vr: rand(-4, 4),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        phase: rand(0, Math.PI * 2),
      });
    }

    for (let i = 0; i < balloonCount; i += 1) {
      particles.push({
        kind: "balloon",
        x: rand(width * 0.08, width * 0.92),
        y: rand(height * 0.45, height * 1.02),
        r: rand(unit * 0.018, unit * 0.032),
        vy: rand(-unit * 0.09, -unit * 0.05),
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        phase: rand(0, Math.PI * 2),
      });
    }

    const bursts: Burst[] = [
      { x: width * rand(0.22, 0.32), y: height * rand(0.2, 0.32), at: 220 },
      { x: width * rand(0.68, 0.8), y: height * rand(0.18, 0.3), at: 780 },
      { x: width * rand(0.44, 0.56), y: height * rand(0.32, 0.44), at: 1360 },
    ].map((burst) => {
      const sparks: Spark[] = Array.from({ length: reduced ? 12 : 20 }, () => {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(unit * 0.08, unit * 0.2);
        return {
          x: burst.x,
          y: burst.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: rand(1.2, unit * 0.006),
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        };
      });
      return { ...burst, sparks };
    });

    let raf = 0;
    let last = performance.now();
    const started = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const elapsed = now - started;
      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        if (particle.kind === "paper") {
          particle.x += (particle.vx + Math.sin(now / 380 + particle.phase) * particle.sway) * dt;
          particle.y += particle.vy * dt;
          particle.rot += particle.vr * dt;
          if (particle.y > height + unit * 0.05) {
            particle.y = -unit * 0.04;
            particle.x = rand(0, width);
          }
          context.save();
          context.translate(particle.x, particle.y);
          context.rotate(particle.rot);
          context.fillStyle = particle.color;
          context.globalAlpha = 0.92;
          context.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
          context.restore();
        } else if (particle.kind === "star") {
          particle.x += (particle.vx + Math.sin(now / 460 + particle.phase) * 18) * dt;
          particle.y += particle.vy * dt;
          particle.rot += particle.vr * dt;
          if (particle.y > height + unit * 0.05) {
            particle.y = -unit * 0.04;
            particle.x = rand(0, width);
          }
          context.save();
          context.translate(particle.x, particle.y);
          context.rotate(particle.rot);
          context.fillStyle = particle.color;
          context.globalAlpha = 0.95;
          starPath(context, particle.r);
          context.fill();
          context.restore();
        } else {
          particle.x += Math.sin(now / 620 + particle.phase) * 16 * dt;
          particle.y += particle.vy * dt;
          if (particle.y < -unit * 0.2) {
            particle.y = height + unit * 0.1;
            particle.x = rand(width * 0.08, width * 0.92);
          }
          const r = particle.r;
          context.save();
          context.globalAlpha = 0.9;
          context.fillStyle = particle.color;
          context.beginPath();
          context.ellipse(particle.x, particle.y, r, r * 1.22, 0, 0, Math.PI * 2);
          context.fill();
          // خيط البالون
          context.strokeStyle = "rgba(120,120,120,0.55)";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(particle.x, particle.y + r * 1.22);
          context.quadraticCurveTo(
            particle.x + Math.sin(now / 500 + particle.phase) * r * 0.5,
            particle.y + r * 2.2,
            particle.x,
            particle.y + r * 3.1,
          );
          context.stroke();
          context.restore();
        }
      }

      for (const burst of bursts) {
        const age = elapsed - burst.at;
        if (age < 0 || age > 1100) continue;
        const fade = 1 - age / 1100;
        context.save();
        context.globalAlpha = Math.max(0, fade);
        context.globalCompositeOperation = "lighter";
        for (const spark of burst.sparks) {
          spark.x += spark.vx * dt;
          spark.y += spark.vy * dt;
          spark.vy += unit * 0.22 * dt;
          spark.vx *= 0.985;
          context.fillStyle = spark.color;
          context.beginPath();
          context.arc(spark.x, spark.y, spark.size * (0.5 + fade), 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }

      if (elapsed < DURATION) raf = requestAnimationFrame(frame);
      else setVisible(false);
    };

    raf = requestAnimationFrame(frame);
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [runId, visible]);

  if (!visible) return null;

  return (
    <canvas
      key={`${runId}-${kind}`}
      ref={canvasRef}
      aria-hidden="true"
      className="celebration-canvas"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 4000,
        animation: `celebration-fade ${DURATION}ms ease-in-out forwards`,
      }}
    />
  );
}
