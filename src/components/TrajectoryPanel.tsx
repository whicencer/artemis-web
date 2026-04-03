"use client";

import { AgeTicker } from "@/components/AgeTicker";
import { SourceStatus } from "@/lib/types";

type TrajectoryPanelProps = {
  distanceEarthKm: number | null;
  distanceMoonKm: number | null;
  velocityKmh: number | null;
  phase: string;
  status: SourceStatus;
  note: string;
  updatedAt: string | null;
  referencePointsCount: number;
};

function formatKm(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return `${formatWholeNumber(Math.round(value))} km`;
}

function formatVelocity(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return `${formatWholeNumber(Math.round(value))} km/h`;
}

function formatWholeNumber(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const grouped = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}`;
}

function statusText(status: SourceStatus): string {
  if (status === "live") return "LIVE";
  if (status === "fallback") return "FALLBACK";
  return "ERROR";
}

function trajectoryProgress(distanceEarthKm: number | null, distanceMoonKm: number | null): number | null {
  if (distanceEarthKm !== null && distanceMoonKm !== null) {
    const total = distanceEarthKm + distanceMoonKm;
    if (total > 0) return Math.max(0, Math.min(1, distanceEarthKm / total));
  }
  if (distanceEarthKm !== null && distanceEarthKm > 0) {
    const roughEarthMoon = 384400;
    return Math.max(0, Math.min(1, distanceEarthKm / roughEarthMoon));
  }
  return null;
}

export function TrajectoryPanel({
  distanceEarthKm,
  distanceMoonKm,
  velocityKmh,
  phase,
  status,
  note,
  updatedAt,
  referencePointsCount
}: TrajectoryPanelProps) {
  const progress = trajectoryProgress(distanceEarthKm, distanceMoonKm);
  const leftPct = progress === null ? 14 : 10 + progress * 80;
  const earthToOrionPct = progress === null ? null : Math.round(progress * 10000) / 100;
  const moonToOrionPct = progress === null ? null : Math.round((1 - progress) * 10000) / 100;
  const earthLabelLeft = 10 + (leftPct - 10) / 2;
  const moonLabelLeft = leftPct + (90 - leftPct) / 2;

  return (
    <section className="panel trajectory-panel">
      <div className="panel-head">
        <h2>Trajectory Track</h2>
        <span className={`status-tag status-${status}`}>{statusText(status)}</span>
      </div>

      <div className="trajectory-canvas">
        <div className="trajectory-path" />
        <div className="trajectory-segment left" style={{ width: `${leftPct}%` }} />
        <div className="trajectory-segment right" style={{ left: `${leftPct}%` }} />
        <div className="trajectory-aura" style={{ left: `${leftPct}%` }} />
        <div className="trajectory-particles" aria-hidden>
          <span className="trajectory-particle p1" />
          <span className="trajectory-particle p2" />
          <span className="trajectory-particle p3" />
          <span className="trajectory-particle p4" />
          <span className="trajectory-particle p5" />
        </div>

        <div className="body-node earth" style={{ left: "10%" }}>
          <span>Earth</span>
        </div>
        <div className="body-node moon" style={{ left: "90%" }}>
          <span>Moon</span>
        </div>
        <div className="body-node orion" style={{ left: `${leftPct}%` }}>
          <span>Orion</span>
        </div>

        {earthToOrionPct !== null ? (
          <div className="trajectory-percent left" style={{ left: `${earthLabelLeft}%` }}>
            {earthToOrionPct.toFixed(2)}%
          </div>
        ) : null}
        {moonToOrionPct !== null ? (
          <div className="trajectory-percent right" style={{ left: `${moonLabelLeft}%` }}>
            {moonToOrionPct.toFixed(2)}%
          </div>
        ) : null}

        <div className="trajectory-readout left">Earth → Orion: {formatKm(distanceEarthKm)}</div>
        <div className="trajectory-readout right">Orion → Moon: {formatKm(distanceMoonKm)}</div>
      </div>

      <div className="trajectory-grid">
        <div className="t-cell">
          <p>Progress To Moon</p>
          <strong>{progress === null ? "Unavailable" : `${(progress * 100).toFixed(2)}%`}</strong>
        </div>
        <div className="t-cell">
          <p>Mission Phase</p>
          <strong>{phase || "MISSION ACTIVE"}</strong>
        </div>
        <div className="t-cell">
          <p>Velocity</p>
          <strong>{formatVelocity(velocityKmh)}</strong>
        </div>
        <div className="t-cell">
          <p>Reference Vectors</p>
          <strong>{referencePointsCount > 0 ? `${referencePointsCount} points` : "Unavailable"}</strong>
        </div>
      </div>

      <div className="trajectory-foot">
        <span>Last updated: <AgeTicker iso={updatedAt} /></span>
      </div>

      <div className="trajectory-subnote">
        {note}
        {progress !== null && (
          <span>
            {" "}
            | Earth leg: {earthToOrionPct}% · Moon leg: {moonToOrionPct}%
          </span>
        )}
      </div>
    </section>
  );
}
