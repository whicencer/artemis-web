"use client";

import { useEffect, useMemo, useState } from "react";
import { formatElapsed } from "@/components/ElapsedTicker";
import { useSecondNow } from "@/lib/clock";
import { TvBroadcastEvent } from "@/lib/types";

type TvBroadcastConsoleProps = {
  events: TvBroadcastEvent[];
  missionStartIso: string | null;
  sourceLabel: string;
};

type EventStatus = "LIVE" | "UPCOMING" | "COMPLETED";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function statusFor(event: TvBroadcastEvent, nowMs: number): EventStatus {
  const start = toMs(event.startTime);
  const end = toMs(event.endTime);
  if (start === null) return "COMPLETED";
  if (nowMs < start) return "UPCOMING";
  if (end !== null && nowMs >= end) return "COMPLETED";
  return "LIVE";
}

function countdownLabel(targetMs: number, nowMs: number): string {
  const delta = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const h = Math.floor(delta / 3600);
  const m = Math.floor((delta % 3600) / 60);
  const s = delta % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function localTime(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const month = MONTHS_SHORT[date.getUTCMonth()] ?? "UNK";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm}:${ss} UTC`;
}

function localClientTime(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function displayTime(iso: string | null, mounted: boolean): string {
  const utc = localTime(iso);
  if (!mounted) return utc;
  const local = localClientTime(iso);
  return `${local} (UTC: ${utc})`;
}

function metForEvent(event: TvBroadcastEvent, missionStartMs: number | null): string {
  if (event.metLabel) return event.metLabel;
  if (missionStartMs === null) return "--/--:--";
  const startMs = toMs(event.startTime);
  if (startMs === null) return "--/--:--";
  const sec = Math.max(0, Math.floor((startMs - missionStartMs) / 1000));
  const days = Math.floor(sec / 86400);
  const hhmm = formatElapsed(sec).slice(3, 8);
  return `${String(days).padStart(2, "0")}/${hhmm}`;
}

function relativeCountdown(targetMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m`;
  return "in <1m";
}

export function TvBroadcastConsole({ events, missionStartIso, sourceLabel }: TvBroadcastConsoleProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const missionStartMs = useMemo(() => toMs(missionStartIso), [missionStartIso]);

  const sorted = useMemo(
    () =>
      [...events].sort((a, b) => {
        const x = toMs(a.startTime) ?? 0;
        const y = toMs(b.startTime) ?? 0;
        return x - y;
      }),
    [events]
  );
  const fallbackNowMs = useMemo(() => toMs(sorted[0]?.startTime) ?? 0, [sorted]);
  const now = useSecondNow();
  const nowMs = now > 0 ? now : fallbackNowMs;

  const activeEvent = sorted.find((event) => statusFor(event, nowMs) === "LIVE") ?? null;
  const upcomingEvents = sorted.filter((event) => statusFor(event, nowMs) === "UPCOMING");
  const completedEvents = sorted.filter((event) => statusFor(event, nowMs) === "COMPLETED");
  const nowEvent = activeEvent ?? upcomingEvents[0] ?? null;
  const nextPool = activeEvent ? upcomingEvents : upcomingEvents.slice(1);
  const nextEvents = nextPool.slice(0, 3);
  const timelineUpcoming = nextPool.slice(3, 15);
  const timelineCompleted = completedEvents.slice(-12).reverse();
  const nowEndMs = toMs(nowEvent?.endTime ?? null);
  const nowStartMs = toMs(nowEvent?.startTime ?? null);
  const compactSource =
    /json/i.test(sourceLabel) ? "TV Schedule JSON" : /xls/i.test(sourceLabel) ? "TV Schedule XLS" : "TV Schedule";
  const nowCountdown = activeEvent
    ? nowEndMs
      ? `Ends in ${countdownLabel(nowEndMs, nowMs)}`
      : "Live coverage in progress"
    : nowStartMs
      ? `Starts ${relativeCountdown(nowStartMs, nowMs)}`
      : "No scheduled item";

  return (
    <section className="panel tv-console-panel">
      <div className="panel-head">
        <h2>TV Broadcast Console</h2>
        <span className="status-tag neutral">{compactSource}</span>
      </div>

      <div className="tv-section-label">Now</div>
      <div className={`tv-now-card ${activeEvent ? "is-live" : ""}`}>
        <div className="tv-now-head">
          <span className={`tv-live-badge ${activeEvent ? "is-live" : "is-standby"}`}>
            <span className="dot" />
            {activeEvent ? "LIVE" : "STANDBY"}
          </span>
          <span className="tv-countdown">{nowCountdown}</span>
        </div>
        <h3>{nowEvent?.title ?? "Awaiting scheduled transmission"}</h3>
        <p>{nowEvent?.description || "No active broadcast item in this window."}</p>
        <div className="tv-now-meta">
          <span>MET {nowEvent ? metForEvent(nowEvent, missionStartMs) : "--/--:--"}</span>
          <span>{displayTime(nowEvent?.startTime ?? null, mounted)}</span>
        </div>
      </div>

      <div className="tv-section-label">Next</div>
      <div className="tv-next-grid">
        {nextEvents.length ? (
          nextEvents.map((event) => {
            const startMs = toMs(event.startTime) ?? nowMs;
            return (
              <article key={event.id} className="tv-next-card">
                <strong>{event.title}</strong>
                <span>{relativeCountdown(startMs, nowMs)}</span>
              </article>
            );
          })
        ) : (
          <p className="placeholder">No upcoming events in current schedule.</p>
        )}
      </div>

      <div className="tv-section-label">Timeline</div>
      <div className="tv-timeline-grid">
        <section className="tv-timeline-col">
          <h4>Completed</h4>
          <div className="tv-timeline-list">
            {timelineCompleted.length ? (
              timelineCompleted.map((event) => (
                <article key={event.id} className="tv-item completed">
                  <span className="tv-icon" aria-hidden>
                    ✓
                  </span>
                  <div>
                    <strong>{event.title}</strong>
                    <span>{displayTime(event.startTime, mounted)}</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="placeholder">No completed events yet.</p>
            )}
          </div>
        </section>

        <section className="tv-timeline-col">
          <h4>Upcoming</h4>
          <div className="tv-timeline-list">
            {timelineUpcoming.length ? (
              timelineUpcoming.map((event) => {
                const startMs = toMs(event.startTime) ?? nowMs;
                return (
                  <article key={event.id} className="tv-item upcoming">
                    <span className="tv-icon" aria-hidden>
                      ○
                    </span>
                    <div>
                      <strong>{event.title}</strong>
                      <span>{relativeCountdown(startMs, nowMs)}</span>
                    </div>
                  </article>
                );
              })
            ) : (
              <p className="placeholder">No more upcoming events.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
