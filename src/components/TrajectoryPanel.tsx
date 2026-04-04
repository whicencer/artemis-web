"use client";

import { useEffect, useMemo, useRef } from "react";
import { AgeTicker } from "@/components/AgeTicker";
import { HorizonsPoint, SourceStatus } from "@/lib/types";

type TrajectoryPanelProps = {
  distanceEarthKm: number | null;
  distanceMoonKm: number | null;
  velocityKmh: number | null;
  phase: string;
  status: SourceStatus;
  note: string;
  updatedAt: string | null;
  trajectoryPoints: HorizonsPoint[];
  moonTrajectoryPoints: HorizonsPoint[];
};

type Vec3 = { x: number; y: number; z: number };
type Projected = { x: number; y: number; s: number };
type CurveTuning = { arc: number; skew: number; depth: number; bend: number };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function formatWhole(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatKm(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return `${formatWhole(Math.round(value))} km`;
}

function formatVelocity(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return `${formatWhole(Math.round(value))} km/h`;
}

function statusText(status: SourceStatus): string {
  if (status === "live") return "LIVE";
  if (status === "fallback") return "FALLBACK";
  return "ERROR";
}

function trajectoryProgress(distanceEarthKm: number | null, distanceMoonKm: number | null): number | null {
  if (distanceEarthKm !== null && distanceMoonKm !== null) {
    const total = distanceEarthKm + distanceMoonKm;
    if (total > 0) return clamp(distanceEarthKm / total, 0, 1);
  }
  if (distanceEarthKm !== null && distanceEarthKm > 0) return clamp(distanceEarthKm / 384400, 0, 1);
  return null;
}

function deriveCurveTuning(orion: HorizonsPoint[], moon: HorizonsPoint[]): CurveTuning {
  const base: CurveTuning = { arc: 0.34, skew: 0.08, depth: 0.2, bend: 0.11 };
  if (orion.length < 2 || moon.length < 2) return base;

  const oFirst = orion[0];
  const oLast = orion[orion.length - 1];
  const mFirst = moon[0];
  const mLast = moon[moon.length - 1];

  const oZSpan = Number.isFinite(oLast.zKm - oFirst.zKm) ? oLast.zKm - oFirst.zKm : 0;
  const mYSpan = Number.isFinite(mLast.yKm - mFirst.yKm) ? mLast.yKm - mFirst.yKm : 0;
  const scale = 420000;

  return {
    arc: clamp(base.arc + mYSpan / scale, 0.24, 0.52),
    skew: clamp(base.skew + oZSpan / (scale * 1.6), -0.12, 0.24),
    depth: clamp(base.depth + oZSpan / (scale * 1.2), 0.12, 0.34),
    bend: clamp(base.bend + mYSpan / (scale * 1.9), 0.06, 0.2)
  };
}

function curvePoint(t: number, tuning: CurveTuning): Vec3 {
  const tt = clamp(t, 0, 1);
  const x = lerp(-1.18, 1.18, tt);
  const y =
    Math.sin((tt + tuning.skew) * Math.PI) * tuning.arc +
    (tt - 0.5) * tuning.bend -
    Math.exp(-Math.pow((tt - 0.82) / 0.2, 2)) * 0.085;
  const z = Math.sin((tt * 1.32 + 0.1) * Math.PI) * tuning.depth + (tt - 0.5) * 0.12;
  return { x, y, z };
}

function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}

function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

function project(v: Vec3, width: number, height: number): Projected {
  const cameraDistance = 3.05;
  const fov = 1.0;
  const z = v.z + cameraDistance;
  const scale = fov / Math.max(0.3, z);
  return {
    x: width * 0.5 + v.x * scale * width * 0.98,
    y: height * 0.53 - v.y * scale * height * 1.28,
    s: scale
  };
}

function trackStateLabel(phase: string, progress: number | null): string {
  const p = phase.toLowerCase();
  if (/(reentry|re-entry|recovery|return)/.test(p)) return "Return to Earth";
  if (/(flyby|approach)/.test(p)) return "Lunar Vicinity";
  if (progress !== null && progress > 0.98) return "Moon Proximity";
  return "Outbound to Moon";
}

function buildStars(width: number, height: number) {
  const count = Math.max(20, Math.min(56, Math.floor((width * height) / 22000)));
  let seed = 94127;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  return Array.from({ length: count }).map(() => ({
    x: rnd() * width,
    y: rnd() * height,
    alpha: 0.06 + rnd() * 0.24,
    radius: 0.35 + rnd() * 0.95
  }));
}

function drawCurve(ctx: CanvasRenderingContext2D, points: Projected[]) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) * 0.5;
    const midY = (points[i].y + points[i + 1].y) * 0.5;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

export function TrajectoryPanel({
  distanceEarthKm,
  distanceMoonKm,
  velocityKmh,
  phase,
  status,
  note,
  updatedAt,
  trajectoryPoints,
  moonTrajectoryPoints
}: TrajectoryPanelProps) {
  const progress = trajectoryProgress(distanceEarthKm, distanceMoonKm);
  const lockedProgress = progress ?? 0.5;

  const tuning = useMemo(() => deriveCurveTuning(trajectoryPoints, moonTrajectoryPoints), [trajectoryPoints, moonTrajectoryPoints]);
  const stateLabel = useMemo(() => trackStateLabel(phase, progress), [phase, progress]);

  const plotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const host = plotRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let stars = buildStars(1, 1);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = buildStars(width, height);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const frame = () => {
      const t = performance.now();
      const yaw = 0.22 + Math.sin(t * 0.00014) * 0.12;
      const pitch = -0.26;

      ctx.clearRect(0, 0, width, height);

      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#040a14");
      bg.addColorStop(1, "#06101f");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const haze = ctx.createRadialGradient(width * 0.56, height * 0.5, 0, width * 0.56, height * 0.5, width * 0.45);
      haze.addColorStop(0, "rgba(65, 118, 188, 0.13)");
      haze.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, width, height);

      for (const star of stars) {
        ctx.fillStyle = `rgba(190, 215, 248, ${star.alpha})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      const samples = 140;
      const worldCurve: Vec3[] = [];
      for (let i = 0; i <= samples; i += 1) {
        worldCurve.push(curvePoint(i / samples, tuning));
      }

      const projectedCurve = worldCurve.map((point) => project(rotateX(rotateY(point, yaw), pitch), width, height));
      const splitIndex = clamp(Math.floor(lockedProgress * samples), 0, samples);
      const completed = projectedCurve.slice(0, splitIndex + 1);
      const remaining = projectedCurve.slice(splitIndex);

      if (remaining.length > 1) {
        ctx.save();
        ctx.setLineDash([5, 6]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(185, 212, 246, 0.48)";
        drawCurve(ctx, remaining);
        ctx.stroke();
        ctx.restore();
      }

      if (completed.length > 1) {
        ctx.lineWidth = 1.35;
        ctx.strokeStyle = "rgba(92, 188, 255, 0.9)";
        ctx.shadowBlur = 5;
        ctx.shadowColor = "rgba(80, 178, 255, 0.35)";
        drawCurve(ctx, completed);
        ctx.stroke();
        ctx.shadowBlur = 0;

        const total = completed.length - 1;
        const pulse = (t * 0.00009) % 1;
        for (let i = 0; i < 2; i += 1) {
          const idx = Math.floor((pulse + i * 0.47) % 1 * total);
          const p = completed[clamp(idx, 0, total)];
          ctx.fillStyle = "rgba(151, 220, 255, 0.66)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5 - i * 0.25, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const earthWorld = curvePoint(0, tuning);
      const moonWorld = curvePoint(1, tuning);
      const orionWorld = curvePoint(lockedProgress, tuning);
      const aheadWorld = curvePoint(clamp(lockedProgress + 0.018, 0, 1), tuning);

      const earth = project(rotateX(rotateY(earthWorld, yaw), pitch), width, height);
      const moon = project(rotateX(rotateY(moonWorld, yaw), pitch), width, height);
      const orion = project(rotateX(rotateY(orionWorld, yaw), pitch), width, height);
      const ahead = project(rotateX(rotateY(aheadWorld, yaw), pitch), width, height);

      const drawBody = (p: Projected, radius: number, fill: string, glow: string) => {
        const r = radius * (0.9 + p.s * 0.7);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.6);
        g.addColorStop(0, glow);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(206, 229, 255, 0.42)";
        ctx.lineWidth = Math.max(1, r * 0.11);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.32, 0, Math.PI * 2);
        ctx.stroke();

        const core = ctx.createRadialGradient(p.x - r * 0.28, p.y - r * 0.32, r * 0.14, p.x, p.y, r);
        core.addColorStop(0, "rgba(248, 252, 255, 0.96)");
        core.addColorStop(0.35, fill);
        core.addColorStop(1, "rgba(20, 34, 56, 0.95)");
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.38, 0, Math.PI * 2);
        ctx.fill();
      };

      const drawEarth = (p: Projected, radius: number) => {
        const r = radius * (0.9 + p.s * 0.7);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.8);
        glow.addColorStop(0, "rgba(88, 186, 255, 0.44)");
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3.8, 0, Math.PI * 2);
        ctx.fill();

        const atmosphere = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.35, r * 0.2, p.x, p.y, r * 1.06);
        atmosphere.addColorStop(0, "rgba(197, 240, 255, 0.98)");
        atmosphere.addColorStop(0.42, "rgba(84, 171, 238, 0.98)");
        atmosphere.addColorStop(1, "rgba(30, 70, 128, 0.98)");
        ctx.fillStyle = atmosphere;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        // stylized continents
        ctx.fillStyle = "rgba(90, 204, 141, 0.82)";
        ctx.beginPath();
        ctx.ellipse(p.x - r * 0.22, p.y - r * 0.12, r * 0.22, r * 0.16, -0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(p.x + r * 0.1, p.y + r * 0.06, r * 0.18, r * 0.13, 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(p.x + r * 0.24, p.y - r * 0.22, r * 0.1, r * 0.07, 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(206, 239, 255, 0.55)";
        ctx.lineWidth = Math.max(1, r * 0.12);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.22, 0, Math.PI * 2);
        ctx.stroke();
      };

      const drawMoon = (p: Projected, radius: number) => {
        const r = radius * (0.9 + p.s * 0.7);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
        glow.addColorStop(0, "rgba(198, 208, 224, 0.34)");
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
        ctx.fill();

        const moonBase = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.32, r * 0.18, p.x, p.y, r * 1.04);
        moonBase.addColorStop(0, "rgba(247, 248, 252, 0.98)");
        moonBase.addColorStop(0.45, "rgba(196, 204, 220, 0.98)");
        moonBase.addColorStop(1, "rgba(130, 140, 160, 0.98)");
        ctx.fillStyle = moonBase;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();

        // crater texture
        const craters = [
          { ox: -0.24, oy: -0.14, rr: 0.15 },
          { ox: 0.2, oy: 0.06, rr: 0.12 },
          { ox: 0.02, oy: -0.22, rr: 0.09 },
          { ox: -0.05, oy: 0.22, rr: 0.1 }
        ];
        for (const c of craters) {
          ctx.fillStyle = "rgba(144, 152, 170, 0.34)";
          ctx.beginPath();
          ctx.arc(p.x + r * c.ox, p.y + r * c.oy, r * c.rr, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(226, 232, 244, 0.26)";
          ctx.lineWidth = Math.max(0.7, r * 0.05);
          ctx.beginPath();
          ctx.arc(p.x + r * c.ox, p.y + r * c.oy, r * c.rr, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.strokeStyle = "rgba(216, 224, 240, 0.42)";
        ctx.lineWidth = Math.max(1, r * 0.1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.18, 0, Math.PI * 2);
        ctx.stroke();
      };

      drawEarth(earth, 11.4);
      drawMoon(moon, 9.1);
      drawBody(orion, 4.2 + Math.sin(t * 0.0031) * 0.42, "rgba(108, 255, 191, 1)", "rgba(120, 255, 199, 0.3)");

      const dx = ahead.x - orion.x;
      const dy = ahead.y - orion.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const tipX = orion.x + ux * 18;
      const tipY = orion.y + uy * 18;

      ctx.strokeStyle = "rgba(136, 236, 255, 0.78)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(orion.x, orion.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      ctx.fillStyle = "rgba(136, 236, 255, 0.86)";
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - ux * 4.3 - uy * 2.2, tipY - uy * 4.3 + ux * 2.2);
      ctx.lineTo(tipX - ux * 4.3 + uy * 2.2, tipY - uy * 4.3 - ux * 2.2);
      ctx.closePath();
      ctx.fill();

      ctx.font = "700 16px var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(218, 231, 251, 0.92)";
      ctx.textAlign = "center";
      ctx.fillText("Earth", earth.x, earth.y + 24);
      ctx.fillText("Moon", moon.x, moon.y + 23);
      ctx.fillText("Orion", orion.x, orion.y + 20);

      // Flat distance rail: Orion marker is always distance-percentage based.
      const railY = height - 18;
      const railStart = width * 0.14;
      const railEnd = width * 0.86;
      const markerX = lerp(railStart, railEnd, lockedProgress);

      ctx.strokeStyle = "rgba(118, 157, 219, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(railStart, railY);
      ctx.lineTo(railEnd, railY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(89, 168, 246, 0.95)";
      ctx.beginPath();
      ctx.arc(railStart, railY, 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(217, 223, 236, 0.95)";
      ctx.beginPath();
      ctx.arc(railEnd, railY, 3.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(108, 255, 191, 0.98)";
      ctx.beginPath();
      ctx.arc(markerX, railY, 3, 0, Math.PI * 2);
      ctx.fill();

      raf = window.requestAnimationFrame(frame);
    };

    raf = window.requestAnimationFrame(frame);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [lockedProgress, tuning]);

  return (
    <section className="panel trajectory-panel">
      <div className="panel-head">
        <h2>Trajectory Track</h2>
        <span className={`status-tag status-${status}`}>{statusText(status)}</span>
      </div>

      <div className="trajectory-canvas" ref={plotRef}>
        <canvas ref={canvasRef} className="trajectory-canvas-el" />
      </div>

      <div className="trajectory-hud-main">
        <div className="hud-card">
          <p>Earth → Orion</p>
          <strong>{formatKm(distanceEarthKm)}</strong>
        </div>
        <div className="hud-card is-center">
          <p>Progress to Moon</p>
          <strong>{progress === null ? "Unavailable" : `${(progress * 100).toFixed(2)}%`}</strong>
        </div>
        <div className="hud-card">
          <p>Orion → Moon</p>
          <strong>{formatKm(distanceMoonKm)}</strong>
        </div>
      </div>

      <div className="trajectory-hud-secondary">
        <div className="hud-mini">
          <span>Velocity</span>
          <strong>{formatVelocity(velocityKmh)}</strong>
        </div>
        <div className="hud-mini">
          <span>Mission Phase</span>
          <strong>{phase || "MISSION ACTIVE"}</strong>
        </div>
      </div>

      <div className="trajectory-foot">
        <span>{stateLabel}</span>
        <span>Last updated: <AgeTicker iso={updatedAt} /></span>
      </div>

      <div className="trajectory-subnote">{note}</div>
    </section>
  );
}
