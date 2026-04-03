import fs from "node:fs";
import path from "node:path";
import { TvBroadcastEvent } from "@/lib/types";

type TvScheduleSnapshot = {
  source: string;
  loadedAt: string | null;
  events: TvBroadcastEvent[];
};

type PublicTvSchedulePayload = {
  generatedAt?: unknown;
  schedule?: {
    source?: unknown;
    loadedAt?: unknown;
    events?: unknown;
  };
};

const DEFAULT_JSON_PATH = path.resolve(process.cwd(), "public", "artemis-tv-schedule.json");
const TV_BROADCAST_JSON_PATH = path.resolve(process.env.TV_BROADCAST_JSON_PATH ?? DEFAULT_JSON_PATH);

const cache: {
  filePath: string;
  mtimeMs: number;
  snapshot: TvScheduleSnapshot;
} = {
  filePath: "",
  mtimeMs: 0,
  snapshot: {
    source: "TV schedule JSON not loaded",
    loadedAt: null,
    events: []
  }
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function normalizeEvent(row: unknown, index: number): TvBroadcastEvent | null {
  if (!isObject(row)) return null;

  const id = typeof row.id === "string" && row.id ? row.id : `tv-${index}`;
  const startTime = typeof row.startTime === "string" ? row.startTime : "";
  const endTime = typeof row.endTime === "string" ? row.endTime : null;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const description = typeof row.description === "string" ? row.description : "";
  const metLabel = typeof row.metLabel === "string" ? row.metLabel : null;
  const metSeconds = typeof row.metSeconds === "number" && Number.isFinite(row.metSeconds) ? row.metSeconds : null;

  if (!startTime || !title) return null;
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) return null;
  if (endTime) {
    const endMs = new Date(endTime).getTime();
    if (!Number.isFinite(endMs)) return null;
  }

  return { id, startTime, endTime, title, description, metLabel, metSeconds };
}

function normalizeSnapshot(payload: PublicTvSchedulePayload): TvScheduleSnapshot {
  const rawEvents = Array.isArray(payload.schedule?.events) ? payload.schedule?.events : [];
  const events = rawEvents
    .map((row, index) => normalizeEvent(row, index))
    .filter((event): event is TvBroadcastEvent => Boolean(event))
    .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));

  for (let i = 0; i < events.length; i += 1) {
    if (!events[i].endTime && events[i + 1]) {
      events[i].endTime = events[i + 1].startTime;
    }
  }

  const source =
    typeof payload.schedule?.source === "string" && payload.schedule.source
      ? payload.schedule.source
      : `TV schedule JSON`;
  const loadedAt =
    typeof payload.schedule?.loadedAt === "string"
      ? payload.schedule.loadedAt
      : typeof payload.generatedAt === "string"
        ? payload.generatedAt
        : null;

  return { source, loadedAt, events };
}

export function getTvBroadcastSchedule(): TvScheduleSnapshot {
  try {
    const stat = fs.statSync(TV_BROADCAST_JSON_PATH);
    if (cache.filePath === TV_BROADCAST_JSON_PATH && cache.mtimeMs === stat.mtimeMs) {
      return cache.snapshot;
    }

    const raw = fs.readFileSync(TV_BROADCAST_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as PublicTvSchedulePayload;
    const snapshot = normalizeSnapshot(parsed);
    cache.filePath = TV_BROADCAST_JSON_PATH;
    cache.mtimeMs = stat.mtimeMs;
    cache.snapshot = snapshot;
    return snapshot;
  } catch {
    return {
      source: `TV schedule JSON unavailable`,
      loadedAt: cache.snapshot.loadedAt,
      events: cache.snapshot.events
    };
  }
}
