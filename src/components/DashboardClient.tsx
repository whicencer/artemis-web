"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AgeTicker } from "@/components/AgeTicker";
import { ElapsedTicker } from "@/components/ElapsedTicker";
import { LiveFeedCard } from "@/components/LiveFeedCard";
import { TvBroadcastConsole } from "@/components/TvBroadcastConsole";
import { DashboardSnapshot, MissionUpdate, SourceStatus } from "@/lib/types";

type DashboardClientProps = {
  initial: DashboardSnapshot;
};

type TelemetrySlice = Pick<DashboardSnapshot, "fetchedAt" | "missionStartIso" | "missionPhase" | "telemetry" | "tracking">;

type SafeSnapshot = {
  fetchedAt: string;
  refreshSeconds: number;
  missionStartIso: string | null;
  missionPhase: {
    value: string;
    status: SourceStatus;
    source: string;
    updatedAt: string | null;
  };
  telemetry: {
    missionElapsed: DashboardSnapshot["telemetry"]["missionElapsed"];
    velocity: DashboardSnapshot["telemetry"]["velocity"];
    distanceEarth: DashboardSnapshot["telemetry"]["distanceEarth"];
    distanceMoon: DashboardSnapshot["telemetry"]["distanceMoon"];
  };
  comms: DashboardSnapshot["comms"];
  tracking: DashboardSnapshot["tracking"];
  streams: DashboardSnapshot["streams"];
  updates: MissionUpdate[];
  updatesSecondary: MissionUpdate[];
  tvBroadcast: DashboardSnapshot["tvBroadcast"];
};

type PublicTvSchedulePayload = {
  generatedAt?: unknown;
  schedule?: {
    source?: unknown;
    loadedAt?: unknown;
    events?: unknown;
  };
};

const TrajectoryPanel = dynamic(
  () => import("@/components/TrajectoryPanel").then((mod) => mod.TrajectoryPanel),
  {
    ssr: false,
    loading: () => (
      <section className="panel trajectory-panel">
        <div className="panel-head">
          <h2>Trajectory Track</h2>
          <span className="status-tag neutral">SYNCING</span>
        </div>
        <div className="trajectory-canvas" />
      </section>
    )
  }
);

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isSourceStatus(value: unknown): value is SourceStatus {
  return value === "live" || value === "fallback" || value === "error";
}

function toStatus(value: unknown): SourceStatus {
  return isSourceStatus(value) ? value : "fallback";
}

function statusClass(status: SourceStatus): string {
  if (status === "live") return "status-live";
  if (status === "fallback") return "status-fallback";
  return "status-error";
}

function formatUtcDateTime(iso: string | null | undefined): string {
  if (!iso) return "Unavailable";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS_SHORT[date.getUTCMonth()] ?? "UNK";
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${day} ${month}, ${hours}:${minutes}:${seconds} UTC`;
}

function formatNumber(value: number | string | null | undefined, unit = ""): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const normalized =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value
        : null
      : typeof value === "string"
        ? parseNumberLike(value)
        : null;
  if (normalized !== null) {
    return `${formatNumberFixed(normalized)}${unit ? ` ${unit}` : ""}`;
  }
  if (typeof value === "string") return `${value}${unit ? ` ${unit}` : ""}`;
  return "Unavailable";
}

function parseNumberLike(input: string): number | null {
  const raw = input.trim().replace(/\s+/g, "");
  if (!raw) return null;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) {
    const lastComma = raw.lastIndexOf(",");
    const lastDot = raw.lastIndexOf(".");
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    const normalized = raw.split(thousandsSep).join("").replace(decimalSep, ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  if (hasComma && !hasDot) {
    const normalized = raw.replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatNumberFixed(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const [intPart, fracPart] = abs.toString().split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;
}

function metricNumber(metric: { value: number | string | null } | null | undefined): number | null {
  if (!metric) return null;
  if (typeof metric.value === "number") return Number.isFinite(metric.value) ? metric.value : null;
  if (typeof metric.value === "string") {
    const num = Number(metric.value.replace(/[\s,]/g, ""));
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function defaultMetric(key: string, label: string) {
  return {
    key,
    label,
    value: null,
    unit: "",
    status: "fallback" as SourceStatus,
    source: "Unavailable",
    updatedAt: null,
    note: "Metric unavailable in current payload."
  };
}

function normalizeUpdates(list: unknown): MissionUpdate[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((row): row is MissionUpdate => {
      if (!row || typeof row !== "object") return false;
      const item = row as Partial<MissionUpdate>;
      return typeof item.timestamp === "string" && typeof item.title === "string";
    })
    .map((item) => ({
      id: item.id || item.link || `${item.title}-${item.timestamp}`,
      timestamp: item.timestamp,
      title: item.title,
      summary: item.summary || "",
      link: item.link || "",
      source: item.source || "NASA"
    }));
}

function normalizeTvBroadcastEvents(list: unknown): DashboardSnapshot["tvBroadcast"]["events"] {
  if (!Array.isArray(list)) return [];

  return list
    .map((row, index) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Partial<DashboardSnapshot["tvBroadcast"]["events"][number]>;
      if (typeof item.startTime !== "string" || typeof item.title !== "string") return null;
      const startMs = new Date(item.startTime).getTime();
      if (!Number.isFinite(startMs)) return null;

      return {
        id: item.id || `tv-${index}`,
        startTime: item.startTime,
        endTime: typeof item.endTime === "string" ? item.endTime : null,
        title: item.title,
        description: item.description || "",
        metLabel: typeof item.metLabel === "string" ? item.metLabel : null,
        metSeconds: typeof item.metSeconds === "number" && Number.isFinite(item.metSeconds) ? item.metSeconds : null
      };
    })
    .filter((event): event is DashboardSnapshot["tvBroadcast"]["events"][number] => Boolean(event))
    .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
}

function tvBroadcastPayloadFromJson(value: unknown): SafeSnapshot["tvBroadcast"] | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as PublicTvSchedulePayload;
  const events = normalizeTvBroadcastEvents(payload.schedule?.events);
  if (!events.length) return null;

  const source =
    typeof payload.schedule?.source === "string" && payload.schedule.source
      ? payload.schedule.source
      : "TV schedule JSON";
  const loadedAt =
    typeof payload.schedule?.loadedAt === "string"
      ? payload.schedule.loadedAt
      : typeof payload.generatedAt === "string"
        ? payload.generatedAt
        : null;

  return { source, loadedAt, events };
}

function safeSnapshot(input: DashboardSnapshot): SafeSnapshot {
  const nowIso = new Date().toISOString();

  return {
    fetchedAt: input.fetchedAt || nowIso,
    refreshSeconds: Number.isFinite(input.refreshSeconds) ? input.refreshSeconds : 30,
    missionStartIso: input.missionStartIso ?? null,
    missionPhase: {
      value: input.missionPhase?.value || "MISSION ACTIVE",
      status: toStatus(input.missionPhase?.status),
      source: input.missionPhase?.source || "Unavailable",
      updatedAt: input.missionPhase?.updatedAt ?? null
    },
    telemetry: {
      missionElapsed: input.telemetry?.missionElapsed ?? defaultMetric("mission_elapsed", "Mission Elapsed"),
      velocity: input.telemetry?.velocity ?? defaultMetric("velocity", "Velocity"),
      distanceEarth: input.telemetry?.distanceEarth ?? defaultMetric("distance_earth", "Distance from Earth"),
      distanceMoon: input.telemetry?.distanceMoon ?? defaultMetric("distance_moon", "Distance to Moon")
    },
    comms: {
      status: toStatus(input.comms?.status),
      source: input.comms?.source || "Unavailable",
      checkedAt: input.comms?.checkedAt || nowIso,
      note: input.comms?.note || "Communication network status unavailable.",
      activeDishes: Number.isFinite(input.comms?.activeDishes) ? input.comms.activeDishes : 0,
      activeSignals: Number.isFinite(input.comms?.activeSignals) ? input.comms.activeSignals : 0,
      artemisTracked: Boolean(input.comms?.artemisTracked)
    },
    tracking: {
      artemisLiveAvailable: Boolean(input.tracking?.artemisLiveAvailable),
      artemisLiveNote: input.tracking?.artemisLiveNote || "Telemetry stream unavailable.",
      artemisTrackerUrl: input.tracking?.artemisTrackerUrl || "https://www.nasa.gov/missions/artemis-ii/arow/",
      points: Array.isArray(input.tracking?.points) ? input.tracking.points : [],
      moonPoints: Array.isArray(input.tracking?.moonPoints) ? input.tracking.moonPoints : [],
      pointsStatus: toStatus(input.tracking?.pointsStatus),
      pointsSource: input.tracking?.pointsSource || "Unavailable"
    },
    streams: {
      officialBroadcast: input.streams?.officialBroadcast || "https://www.youtube.com/watch?v=m3kR2KK8TEs",
      orionViews: input.streams?.orionViews || "https://www.youtube.com/watch?v=6RwfNBtepa4",
      nasaLiveHub: input.streams?.nasaLiveHub || "https://www.nasa.gov/live/"
    },
    updates: normalizeUpdates(input.updates),
    updatesSecondary: normalizeUpdates(input.updatesSecondary),
    tvBroadcast: {
      source: input.tvBroadcast?.source || "TV schedule unavailable",
      loadedAt: input.tvBroadcast?.loadedAt ?? null,
      events: Array.isArray(input.tvBroadcast?.events) ? input.tvBroadcast.events : []
    }
  };
}

function dashboardPayloadFromJson(value: unknown): Partial<DashboardSnapshot> | null {
  if (!value || typeof value !== "object") return null;
  if ("error" in value) return null;
  return value as Partial<DashboardSnapshot>;
}

function telemetryPayloadFromJson(value: unknown): Partial<TelemetrySlice> | null {
  if (!value || typeof value !== "object") return null;
  if ("error" in value) return null;
  const patch = value as Partial<TelemetrySlice>;
  if (!patch.telemetry) return null;
  return patch;
}

function metricEqual(
  a: DashboardSnapshot["telemetry"]["velocity"],
  b: DashboardSnapshot["telemetry"]["velocity"]
): boolean {
  return (
    a.value === b.value &&
    a.unit === b.unit &&
    a.status === b.status &&
    a.source === b.source &&
    a.updatedAt === b.updatedAt &&
    a.note === b.note
  );
}

function missionPhaseEqual(a: DashboardSnapshot["missionPhase"], b: DashboardSnapshot["missionPhase"]): boolean {
  return a.value === b.value && a.status === b.status && a.source === b.source && a.updatedAt === b.updatedAt;
}

function trackingSummaryEqual(a: DashboardSnapshot["tracking"], b: DashboardSnapshot["tracking"]): boolean {
  return (
    a.artemisLiveAvailable === b.artemisLiveAvailable &&
    a.artemisLiveNote === b.artemisLiveNote &&
    a.artemisTrackerUrl === b.artemisTrackerUrl &&
    a.pointsStatus === b.pointsStatus &&
    a.pointsSource === b.pointsSource &&
    a.points.length === b.points.length &&
    a.moonPoints.length === b.moonPoints.length
  );
}

type SystemState = "Connected" | "Delayed" | "Fallback" | "Error";

function systemStateToClass(state: SystemState): string {
  if (state === "Connected") return "status-live";
  if (state === "Error") return "status-error";
  return "status-fallback";
}

function telemetrySystemState(safe: SafeSnapshot): SystemState {
  const hasValues =
    safe.telemetry.velocity.value !== null ||
    safe.telemetry.distanceEarth.value !== null ||
    safe.telemetry.distanceMoon.value !== null;

  const statuses = [safe.telemetry.velocity.status, safe.telemetry.distanceEarth.status, safe.telemetry.distanceMoon.status];
  if (statuses.includes("live")) return "Connected";
  if (!hasValues) return "Error";

  const updatedAt = safe.telemetry.velocity.updatedAt || safe.telemetry.distanceEarth.updatedAt || safe.telemetry.distanceMoon.updatedAt;
  if (updatedAt) {
    const updatedMs = new Date(updatedAt).getTime();
    if (Number.isFinite(updatedMs) && Date.now() - updatedMs > 120_000) return "Delayed";
  }

  return "Fallback";
}

function eventFeedSystemState(entries: MissionUpdate[]): SystemState {
  return entries.length > 0 ? "Connected" : "Error";
}

function videoSystemState(streams: SafeSnapshot["streams"]): SystemState {
  const valid = /youtube\.com|youtu\.be/.test(streams.officialBroadcast) && /youtube\.com|youtu\.be/.test(streams.orionViews);
  return valid ? "Connected" : "Error";
}

export function DashboardClient({ initial }: DashboardClientProps) {
  const [slowSnapshot, setSlowSnapshot] = useState<DashboardSnapshot>(initial);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySlice>({
    fetchedAt: initial.fetchedAt,
    missionStartIso: initial.missionStartIso ?? null,
    missionPhase: initial.missionPhase,
    telemetry: initial.telemetry,
    tracking: initial.tracking
  });

  const [expanded, setExpanded] = useState(false);
  const [slowRefreshing, setSlowRefreshing] = useState(false);
  const [telemetryRefreshing, setTelemetryRefreshing] = useState(false);
  const [clientTvBroadcast, setClientTvBroadcast] = useState<SafeSnapshot["tvBroadcast"] | null>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();

    const loadSchedule = async () => {
      try {
        const res = await fetch("/artemis-tv-schedule.json", { cache: "no-store", signal: controller.signal });
        if (!res.ok || disposed) return;
        const json = (await res.json()) as unknown;
        const parsed = tvBroadcastPayloadFromJson(json);
        if (!parsed || disposed) return;
        setClientTvBroadcast((prev) => {
          if (
            prev &&
            prev.source === parsed.source &&
            prev.loadedAt === parsed.loadedAt &&
            prev.events.length === parsed.events.length
          ) {
            return prev;
          }
          return parsed;
        });
      } catch {
        // keep initial snapshot fallback
      }
    };

    void loadSchedule();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let timer: number | undefined;

    const schedule = () => {
      if (disposed) return;
      timer = window.setTimeout(() => {
        void pull();
      }, 10_000);
    };

    const pull = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);

      try {
        setTelemetryRefreshing(true);
        const res = await fetch("/api/telemetry", { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = (await res.json()) as unknown;
        const patch = telemetryPayloadFromJson(json);
        if (!patch || disposed) return;

        setTelemetrySnapshot((prev) => {
          const next: TelemetrySlice = {
            fetchedAt: patch.fetchedAt || prev.fetchedAt,
            missionStartIso: patch.missionStartIso ?? prev.missionStartIso,
            missionPhase: patch.missionPhase || prev.missionPhase,
            telemetry: {
              missionElapsed: patch.telemetry?.missionElapsed || prev.telemetry.missionElapsed,
              velocity: patch.telemetry?.velocity || prev.telemetry.velocity,
              distanceEarth: patch.telemetry?.distanceEarth || prev.telemetry.distanceEarth,
              distanceMoon: patch.telemetry?.distanceMoon || prev.telemetry.distanceMoon
            },
            tracking: patch.tracking || prev.tracking
          };

          const unchanged =
            prev.missionStartIso === next.missionStartIso &&
            missionPhaseEqual(prev.missionPhase, next.missionPhase) &&
            metricEqual(prev.telemetry.missionElapsed, next.telemetry.missionElapsed) &&
            metricEqual(prev.telemetry.velocity, next.telemetry.velocity) &&
            metricEqual(prev.telemetry.distanceEarth, next.telemetry.distanceEarth) &&
            metricEqual(prev.telemetry.distanceMoon, next.telemetry.distanceMoon) &&
            trackingSummaryEqual(prev.tracking, next.tracking);

          return unchanged ? prev : next;
        });

      } catch {
        // keep last known telemetry on failures; next poll will retry
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
        if (!disposed) setTelemetryRefreshing(false);
        schedule();
      }
    };

    schedule();

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let failCount = 0;
    let timer: number | undefined;

    const schedule = () => {
      if (disposed) return;
      const delay = failCount === 0 ? 30_000 : Math.min(90_000, 30_000 * 2 ** Math.min(2, failCount));
      timer = window.setTimeout(() => {
        void pull();
      }, delay);
    };

    const pull = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);

      try {
        setSlowRefreshing(true);
        const res = await fetch("/api/dashboard", { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = (await res.json()) as unknown;
        const patch = dashboardPayloadFromJson(json);
        if (!patch || disposed) return;

        setSlowSnapshot((prev) => ({
          ...prev,
          ...patch,
          telemetry: prev.telemetry,
          missionStartIso: prev.missionStartIso,
          missionPhase: prev.missionPhase,
          tracking: {
            ...(patch.tracking || prev.tracking),
            artemisLiveAvailable: prev.tracking.artemisLiveAvailable,
            artemisLiveNote: prev.tracking.artemisLiveNote,
            artemisTrackerUrl: prev.tracking.artemisTrackerUrl,
            points: patch.tracking?.points || prev.tracking.points,
            moonPoints: patch.tracking?.moonPoints || prev.tracking.moonPoints,
            pointsStatus: patch.tracking?.pointsStatus || prev.tracking.pointsStatus,
            pointsSource: patch.tracking?.pointsSource || prev.tracking.pointsSource
          }
        }));

        failCount = 0;
      } catch {
        failCount += 1;
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
        if (!disposed) setSlowRefreshing(false);
        schedule();
      }
    };

    schedule();

    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const mergedSnapshot = useMemo<DashboardSnapshot>(() => {
    return {
      ...slowSnapshot,
      fetchedAt: telemetrySnapshot.fetchedAt || slowSnapshot.fetchedAt,
      missionStartIso: telemetrySnapshot.missionStartIso ?? slowSnapshot.missionStartIso ?? null,
      missionPhase: telemetrySnapshot.missionPhase || slowSnapshot.missionPhase,
      telemetry: telemetrySnapshot.telemetry,
      tracking: {
        ...slowSnapshot.tracking,
        ...telemetrySnapshot.tracking,
        points: slowSnapshot.tracking.points,
        moonPoints: slowSnapshot.tracking.moonPoints,
        pointsStatus: slowSnapshot.tracking.pointsStatus,
        pointsSource: slowSnapshot.tracking.pointsSource
      }
    };
  }, [slowSnapshot, telemetrySnapshot]);

  const safe = useMemo(() => safeSnapshot(mergedSnapshot), [mergedSnapshot]);
  const tvBroadcast = clientTvBroadcast ?? safe.tvBroadcast;

  const mergedUpdates = useMemo(() => {
    return [...safe.updates, ...safe.updatesSecondary].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
  }, [safe.updates, safe.updatesSecondary]);

  const visibleUpdates = expanded ? mergedUpdates.slice(0, 18) : mergedUpdates.slice(0, 8);

  const earthKm = metricNumber(safe.telemetry.distanceEarth);
  const moonKm = metricNumber(safe.telemetry.distanceMoon);
  const velocityKmh = metricNumber(safe.telemetry.velocity);
  const progress =
    earthKm !== null && moonKm !== null && earthKm + moonKm > 0
      ? Math.max(0, Math.min(1, earthKm / (earthKm + moonKm)))
      : null;

  const latestUpdate = mergedUpdates[0] ?? null;
  const telemetryState = telemetrySystemState(safe);
  const eventFeedState = eventFeedSystemState(mergedUpdates);
  const videoState = videoSystemState(safe.streams);
  const telemetryUpdatedAt = safe.telemetry.velocity.updatedAt || safe.telemetry.distanceEarth.updatedAt || safe.fetchedAt;

  return (
    <main className="mc-root">
      <header className="panel mc-header">
        <div>
          <p className="kicker">NASA ARTEMIS II</p>
          <h1>Mission Control Dashboard</h1>
          <p className="subtitle">Live operations console · telemetry-first · official source integrity</p>
        </div>
        <div className="header-status-grid">
          <span className={`status-chip ${systemStateToClass(telemetryState)}`}>Telemetry {telemetryState.toUpperCase()}</span>
          <span className={`status-chip ${systemStateToClass(eventFeedState)}`}>Event Feed {eventFeedState.toUpperCase()}</span>
          <span className={`status-chip ${systemStateToClass(videoState)}`}>Video {videoState.toUpperCase()}</span>
          <span className="status-chip neutral">Poll T:10s · C:30s</span>
          <span className="status-chip neutral">Refresh {telemetryRefreshing || slowRefreshing ? "syncing" : "synced"}</span>
          <span className="status-chip neutral">Last updated: <AgeTicker iso={safe.fetchedAt} /></span>
        </div>
      </header>

      <section className="mc-main-grid">
        <aside className="panel mc-overview">
          <div className="panel-head">
            <h2>Mission Overview</h2>
            <span className={`status-tag ${statusClass(safe.telemetry.velocity.status)}`}>{safe.telemetry.velocity.status.toUpperCase()}</span>
          </div>

          <div className="metric-grid">
            <article className="metric-card">
              <p>Elapsed (D:HH:MM:SS)</p>
              <strong><ElapsedTicker value={safe.telemetry.missionElapsed.value} anchorIso={safe.missionStartIso} /></strong>
            </article>
            <article className="metric-card">
              <p>Velocity</p>
              <strong>{formatNumber(safe.telemetry.velocity.value, safe.telemetry.velocity.unit || "")}</strong>
            </article>
            <article className="metric-card">
              <p>Orion → Earth</p>
              <strong>{formatNumber(safe.telemetry.distanceEarth.value, "km")}</strong>
            </article>
            <article className="metric-card">
              <p>Orion → Moon</p>
              <strong>{formatNumber(safe.telemetry.distanceMoon.value, "km")}</strong>
            </article>
            <article className="metric-card">
              <p>Mission Phase</p>
              <strong>{safe.missionPhase.value}</strong>
            </article>
            <article className="metric-card">
              <p>Progress</p>
              <strong>{progress === null ? "Unavailable" : `${(progress * 100).toFixed(2)}%`}</strong>
            </article>
          </div>

          <div className="overview-meta">
            <div>
              <span>Last updated</span>
              <strong><AgeTicker iso={telemetryUpdatedAt} /></strong>
            </div>
          </div>

          <h3 className="subhead">System / Source Status</h3>
          <div className="source-list">
            <article className="source-row">
              <span className={`source-dot ${systemStateToClass(telemetryState)}`} />
              <div>
                <p>Telemetry</p>
                <span>{telemetryState}</span>
              </div>
              <time>Last updated: <AgeTicker iso={telemetryUpdatedAt} /></time>
            </article>
            <article className="source-row">
              <span className={`source-dot ${systemStateToClass(eventFeedState)}`} />
              <div>
                <p>Event Feed</p>
                <span>{eventFeedState}</span>
              </div>
              <time>Last updated: <AgeTicker iso={latestUpdate?.timestamp || safe.fetchedAt} /></time>
            </article>
            <article className="source-row">
              <span className={`source-dot ${systemStateToClass(videoState)}`} />
              <div>
                <p>Video</p>
                <span>{videoState === "Connected" ? "Embedded" : videoState}</span>
              </div>
              <time>Last updated: <AgeTicker iso={safe.fetchedAt} /></time>
            </article>
          </div>
        </aside>

        <div className="mc-center-column">
          <TrajectoryPanel
            distanceEarthKm={earthKm}
            distanceMoonKm={moonKm}
            velocityKmh={velocityKmh}
            phase={safe.missionPhase.value}
            status={safe.telemetry.distanceEarth.status === "live" || safe.telemetry.distanceMoon.status === "live" ? "live" : safe.telemetry.distanceEarth.status}
            note={safe.tracking.artemisLiveNote}
            updatedAt={safe.telemetry.distanceEarth.updatedAt || safe.telemetry.velocity.updatedAt}
            trajectoryPoints={safe.tracking.points}
            moonTrajectoryPoints={safe.tracking.moonPoints}
          />

          <TvBroadcastConsole
            events={tvBroadcast.events}
            missionStartIso={safe.missionStartIso}
            sourceLabel={tvBroadcast.source}
          />

          <section className="panel latest-update-panel">
            <div className="panel-head">
              <h2>Latest Official Update</h2>
              <span className="status-tag neutral">Blog + Artemis News</span>
            </div>
            {latestUpdate ? (
              <article className="latest-update-card">
                <time>{formatUtcDateTime(latestUpdate.timestamp)}</time>
                <h3>{latestUpdate.title}</h3>
                <p>{latestUpdate.summary || "No summary available."}</p>
                <div className="latest-foot">
                  <span>{latestUpdate.source}</span>
                  {latestUpdate.link ? (
                    <a href={latestUpdate.link} target="_blank" rel="noreferrer noopener">
                      Open Source
                    </a>
                  ) : null}
                </div>
              </article>
            ) : (
              <p className="placeholder">No official update payload available yet.</p>
            )}
          </section>

          <section className="panel feed-panel">
            <div className="panel-head">
              <h2>Official Event Feed</h2>
              <span className="status-tag neutral">{mergedUpdates.length} entries</span>
            </div>
            <div className={`event-list ${expanded ? "expanded" : "collapsed"}`}>
              {visibleUpdates.map((entry) => (
                <article className="event-row" key={entry.id}>
                  <time>{formatUtcDateTime(entry.timestamp)}</time>
                  <div>
                    <h3>{entry.title}</h3>
                    <p>{entry.summary || "No summary available."}</p>
                    <small>{entry.source}</small>
                  </div>
                  {entry.link ? (
                    <a href={entry.link} target="_blank" rel="noreferrer noopener">
                      Source
                    </a>
                  ) : (
                    <span className="disabled-link">N/A</span>
                  )}
                </article>
              ))}
            </div>
            {mergedUpdates.length > 8 ? (
              <div className="event-actions">
                <button type="button" onClick={() => setExpanded((prev) => !prev)} className="toggle-btn">
                  {expanded ? "Show Less" : "Show More"}
                </button>
              </div>
            ) : null}
          </section>
        </div>

        <aside className="mc-right-column">
          <section className="panel feeds-panel">
            <div className="panel-head">
              <h2>Live Feeds</h2>
              <span className="status-tag neutral">Primary + Orion</span>
            </div>
            <div className="feed-stack">
              <LiveFeedCard
                title="Primary Broadcast"
                sourceUrl={safe.streams.officialBroadcast}
                autoplayMode="prefer-sound"
              />
              <LiveFeedCard
                title="Orion Live Views"
                sourceUrl={safe.streams.orionViews}
                autoplayMode="muted"
              />
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
