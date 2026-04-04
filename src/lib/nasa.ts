import {
  ARTEMIS_II_LAUNCH_ISO,
  DEFAULT_ARTEMIS_II_LAUNCH_ISO,
  REFRESH_SECONDS,
  SOURCE_URLS,
  TELEMETRY_REFRESH_SECONDS
} from "@/lib/config";
import { DashboardSnapshot, HorizonsPoint, MissionUpdate, SourceHealth, SourceStatus, TelemetryMetric } from "@/lib/types";
import { getTvBroadcastSchedule } from "@/lib/tvSchedule";

type FetchProbe = {
  ok: boolean;
  status: number;
  text: string;
  latencyMs: number;
  error?: string;
};

type ArowTelemetryParsed = {
  missionElapsedRaw: string | null;
  velocityKmh: number | null;
  distanceEarthKm: number | null;
  distanceMoonKm: number | null;
  earthRangeKm: number | null;
  orionXKm: number | null;
  orionYKm: number | null;
  orionZKm: number | null;
};

type ArowTelemetryResult = {
  status: SourceStatus;
  source: string;
  updatedAt: string | null;
  note: string;
  parsed: ArowTelemetryParsed;
};

type UpdatesTelemetryFallback = {
  missionElapsedRaw: string | null;
  velocityKmh: number | null;
  distanceEarthKm: number | null;
  distanceMoonKm: number | null;
  source: string;
  updatedAt: string | null;
};

type TelemetryContext = {
  launchIso: string | null;
  phase: string;
  updateTelemetry: UpdatesTelemetryFallback;
  moonReferenceKm: number;
  moonVector: { xKm: number; yKm: number; zKm: number } | null;
  updatedAt: string;
};

type TelemetrySnapshot = Pick<DashboardSnapshot, "fetchedAt" | "missionStartIso" | "missionPhase" | "telemetry" | "tracking">;

const RUNTIME_HEADERS = { "user-agent": "artemis-ii-mission-control-dashboard/1.0" };

const lastArowTelemetryCache: { value: { parsed: ArowTelemetryParsed; source: string; updatedAt: string } | null } = {
  value: null
};

const lastHorizonsTelemetryCache: {
  value: { parsed: ArowTelemetryParsed; source: string; updatedAt: string } | null;
  checkedAt: number;
} = {
  value: null,
  checkedAt: 0
};

const lastTelemetryContextCache: { value: TelemetryContext | null } = {
  value: null
};

const arowMissionFilesCache: { value: string[] | null; checkedAt: number } = {
  value: null,
  checkedAt: 0
};
const arowMissionBasesCache: { value: string[] | null; checkedAt: number } = {
  value: null,
  checkedAt: 0
};

const FALLBACK_MOON_DISTANCE_KM = 384400;
const EARTH_RADIUS_KM = 6378.137;
const AROW_GCS_BUCKET = "p-2-cen1";
const AROW_GCS_OCTOBER_PREFIX = "October/1/";
const AROW_GCS_PRIMARY_OBJECT = "October/1/October_105_1.txt";

function toIsoSafe(value: string): string | null {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function decodeHtml(input: string): string {
  return input
    .replace(/<!\[CDATA\[(.*?)]]>/gs, "$1")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, "...")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYoutubeId(url: string): string {
  const match = url.match(/[?&]v=([^&]+)/);
  return match?.[1] ?? "";
}

export function getYoutubeEmbedUrl(url: string): string {
  const id = parseYoutubeId(url);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=0&rel=0&modestbranding=1` : url;
}

async function fetchProbe(url: string, revalidateSeconds = REFRESH_SECONDS): Promise<FetchProbe> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, {
      next: { revalidate: revalidateSeconds },
      headers: RUNTIME_HEADERS,
      signal: controller.signal
    });

    return {
      ok: res.ok,
      status: res.status,
      text: await res.text(),
      latencyMs: Date.now() - started
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "request failed"
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseMissionUpdates(feedXml: string): MissionUpdate[] {
  const items = [...feedXml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

  return items
    .map((item) => {
      const categories = [...item.matchAll(/<category><!\[CDATA\[(.*?)]]><\/category>/g)]
        .map((m) => m[1].toLowerCase())
        .join(" ");

      const title = decodeHtml(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const link = decodeHtml(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "");
      const pubDate = decodeHtml(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
      const summary = decodeHtml(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "");
      const ts = toIsoSafe(pubDate);

      const isArtemis2 = categories.includes("artemis 2") || /artemis ii/i.test(title) || /artemis ii/i.test(summary);

      return {
        keep: isArtemis2,
        parsed: {
          id: link || `${title}-${pubDate}`,
          timestamp: ts ?? new Date().toISOString(),
          title,
          summary,
          link,
          source: "NASA Missions Blog"
        } as MissionUpdate
      };
    })
    .filter((entry) => entry.keep)
    .map((entry) => entry.parsed)
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))
    .slice(0, 20);
}

function parseWpArtemisUpdates(payload: string): MissionUpdate[] {
  try {
    const rows = JSON.parse(payload) as Array<{
      id?: number;
      date?: string;
      link?: string;
      title?: { rendered?: string };
      excerpt?: { rendered?: string };
    }>;

    return rows
      .map((row) => {
        const title = decodeHtml(row.title?.rendered ?? "");
        const summary = decodeHtml(row.excerpt?.rendered ?? "");
        const link = row.link ?? "";
        const timestamp = toIsoSafe(row.date ?? "") ?? new Date().toISOString();
        const isArtemis2 = /artemis ii|artemis-ii|artemis 2|artemis-2/i.test(`${title} ${summary} ${link}`);

        return {
          keep: isArtemis2,
          parsed: {
            id: String(row.id ?? link ?? `${title}-${timestamp}`),
            timestamp,
            title,
            summary,
            link,
            source: "NASA Artemis II News"
          } as MissionUpdate
        };
      })
      .filter((entry) => entry.keep)
      .map((entry) => entry.parsed)
      .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))
      .slice(0, 12);
  } catch {
    return [];
  }
}

async function fetchDsnNowContext() {
  const probe = await fetchProbe(SOURCE_URLS.dsnXml);
  if (!probe.ok) {
    return {
      status: "error" as SourceStatus,
      source: SOURCE_URLS.dsnXml,
      checkedAt: new Date().toISOString(),
      note: "Unable to read DSN status.",
      activeDishes: 0,
      activeSignals: 0,
      artemisTracked: false
    };
  }

  const dishBlocks = [...probe.text.matchAll(/<dish\b[\s\S]*?<\/dish>/g)].map((m) => m[0]);
  const activeBySignal = dishBlocks.filter((block) => /<(upSignal|downSignal)\s+active="true"/i.test(block));
  const activeSignals = [...probe.text.matchAll(/<(upSignal|downSignal)\s+active="true"/gi)].length;
  const artemisTracked = /<target[^>]+name="EM2"/i.test(probe.text) || /spacecraft="EM2"/i.test(probe.text);

  return {
    status: activeBySignal.length > 0 ? ("live" as SourceStatus) : ("fallback" as SourceStatus),
    source: SOURCE_URLS.dsnXml,
    checkedAt: new Date().toISOString(),
    note: artemisTracked ? "DSN is tracking Artemis II." : "DSN reachable; Artemis II target not currently active.",
    activeDishes: activeBySignal.length,
    activeSignals,
    artemisTracked
  };
}

function derivePhase(updates: MissionUpdate[], previousPhase?: string | null): string {
  const window = updates.slice(0, 10);
  const normalizedTexts = window.map((item) => `${item.title ?? ""} ${item.summary ?? ""}`.toLowerCase());
  const recentContext = normalizedTexts.slice(0, 5).join(" ");
  const fullContext = normalizedTexts.join(" ");

  const phaseRules: Array<{ phase: string; patterns: RegExp[] }> = [
    {
      phase: "REENTRY / RECOVERY",
      patterns: [/\bsplashdown\b/, /\breentry\b/, /\bre-entry\b/, /\brecovery\b/, /\bparachute\b/]
    },
    {
      phase: "RETURN COAST",
      patterns: [/\breturn to earth\b/, /\bheading back\b/, /\breturn trajectory\b/, /\boutbound from moon\b/, /\bjourney back\b/]
    },
    {
      phase: "LUNAR FLYBY",
      patterns: [/\bclosest approach\b/, /\bflyby\b/, /\blunar flyby\b/, /\bpassed the moon\b/]
    },
    {
      phase: "LUNAR APPROACH",
      patterns: [/\bapproaching the moon\b/, /\blunar approach\b/, /\bnearing the moon\b/, /\bpreparing for flyby\b/]
    },
    {
      phase: "TRANSLUNAR COAST",
      patterns: [/\btranslunar\b/, /\btli\b/, /\btranslunar injection\b/, /\ben route to the moon\b/, /\bjourney to the moon\b/]
    },
    {
      phase: "EARTH ORBIT OPS",
      patterns: [/\bearth orbit\b/, /\bparking orbit\b/, /\bpost-launch orbit\b/, /\borbit\b/]
    },
    {
      phase: "LAUNCH",
      patterns: [/\bliftoff\b/, /\blaunch\b/, /\blaunched\b/, /\bascent\b/]
    }
  ];

  for (const rule of phaseRules) {
    if (rule.patterns.some((pattern) => pattern.test(recentContext))) return rule.phase;
    if (rule.patterns.some((pattern) => pattern.test(fullContext))) return rule.phase;
  }

  if (previousPhase) return previousPhase;
  return "MISSION ACTIVE";
}

function extractTelemetryFromUpdates(updates: MissionUpdate[]): UpdatesTelemetryFallback {
  const samples = updates.slice(0, 8);
  const combined = samples.map((item) => `${item.title} ${item.summary}`).join(" ");
  const updatedAt = samples[0]?.timestamp ?? null;

  const distEarthMatch = combined.match(/([0-9][0-9,.\s]*)\s*(miles|mi|kilometers|kilometres|km)\s*(?:from|away from)\s*earth/i);
  const distMoonMatch = combined.match(/([0-9][0-9,.\s]*)\s*(miles|mi|kilometers|kilometres|km)\s*(?:from|away from|to)\s*(?:the\s*)?moon/i);
  const velocityMatch = combined.match(/([0-9][0-9,.\s]*)\s*(mph|km\/h|kph)\b/i);
  const elapsedMatch = combined.match(/mission elapsed(?: time)?[^0-9]*([0-9]{1,3}\s*(?::\s*[0-9]{1,2}){2,3}|[0-9]+\s*d\s*[0-9]+\s*h\s*[0-9]+\s*m)/i);

  const toNum = (raw?: string) => {
    if (!raw) return null;
    const num = Number(raw.replace(/[\s,]+/g, ""));
    return Number.isFinite(num) ? num : null;
  };

  const toKm = (value: number | null, unit?: string) => {
    if (value === null) return null;
    const normalized = (unit ?? "").toLowerCase();
    return normalized === "mi" || normalized === "miles" ? value * 1.60934 : value;
  };

  const velocityRaw = toNum(velocityMatch?.[1]);
  const velocityUnit = (velocityMatch?.[2] ?? "").toLowerCase();

  return {
    missionElapsedRaw: elapsedMatch?.[1]?.replace(/\s+/g, " ").trim() ?? null,
    velocityKmh: velocityRaw === null ? null : velocityUnit === "mph" ? velocityRaw * 1.60934 : velocityRaw,
    distanceEarthKm: toKm(toNum(distEarthMatch?.[1]), distEarthMatch?.[2]),
    distanceMoonKm: toKm(toNum(distMoonMatch?.[1]), distMoonMatch?.[2]),
    source: "NASA official Artemis II updates",
    updatedAt
  };
}

function parseArowTelemetryFromPayload(payload: string): ArowTelemetryParsed {
  const earth = payload.match(/Distance\s*From\s*Earth[^0-9]*([0-9][0-9,.]*)\s*(km|kilometers|mi|miles)?/i);
  const moon = payload.match(/Distance\s*To\s*Moon[^0-9]*([0-9][0-9,.]*)\s*(km|kilometers|mi|miles)?/i);
  const velocity = payload.match(/Velocity[^0-9]*([0-9][0-9,.]*)\s*(km\/h|kph|mph)?/i);
  const elapsed = payload.match(/Mission\s*Elapsed\s*Time[^0-9]*([0-9]{1,3}[:hmds\s0-9]+)/i);

  const toNumber = (value?: string) => {
    if (!value) return null;
    const num = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(num) ? num : null;
  };

  const toKm = (value: number | null, unit?: string) => {
    if (value === null) return null;
    const normalized = (unit ?? "").toLowerCase();
    return normalized === "mi" || normalized === "miles" ? value * 1.60934 : value;
  };

  const velocityRaw = toNumber(velocity?.[1]);
  const velocityUnit = (velocity?.[2] ?? "").toLowerCase();

  return {
    missionElapsedRaw: elapsed?.[1]?.trim() ?? null,
    velocityKmh: velocityRaw === null ? null : velocityUnit === "mph" ? velocityRaw * 1.60934 : velocityRaw,
    distanceEarthKm: toKm(toNumber(earth?.[1]), earth?.[2]),
    distanceMoonKm: toKm(toNumber(moon?.[1]), moon?.[2]),
    earthRangeKm: null,
    orionXKm: null,
    orionYKm: null,
    orionZKm: null
  };
}

function toHorizonsUtcString(date: Date): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function buildHorizonsVectorsUrl(command: string, center: string, start: Date, stop: Date, step = "1 m"): string {
  const params = new URLSearchParams({
    format: "json",
    COMMAND: `'${command}'`,
    EPHEM_TYPE: "'VECTORS'",
    CENTER: `'${center}'`,
    START_TIME: `'${toHorizonsUtcString(start)}'`,
    STOP_TIME: `'${toHorizonsUtcString(stop)}'`,
    STEP_SIZE: `'${step}'`
  });
  return `${SOURCE_URLS.horizons}?${params.toString()}`;
}

function nearestHorizonsPoint(points: HorizonsPoint[], targetIso: string): HorizonsPoint | null {
  if (!points.length) return null;
  const targetMs = new Date(targetIso).getTime();
  const nearest = points.reduce<{ point: HorizonsPoint; delta: number } | null>((best, point) => {
    const ms = new Date(point.epoch).getTime();
    if (!Number.isFinite(ms)) return best;
    const delta = Math.abs(ms - targetMs);
    if (!best || delta < best.delta) return { point, delta };
    return best;
  }, null);
  return nearest?.point ?? null;
}

function parseHorizonsProbePoints(probe: FetchProbe): HorizonsPoint[] {
  if (!probe.ok) return [];
  try {
    const payload = JSON.parse(probe.text) as { result?: string; error?: string };
    if (payload.error) return [];
    return parseHorizonsVectors(payload.result ?? "");
  } catch {
    return [];
  }
}

async function fetchHorizonsOrionTelemetry(
  nowIso: string,
  revalidateSeconds = TELEMETRY_REFRESH_SECONDS
): Promise<ArowTelemetryResult | null> {
  const nowMs = Date.now();
  const cacheTtlMs = Math.max(1, Math.min(30, revalidateSeconds)) * 1000;
  if (lastHorizonsTelemetryCache.value && nowMs - lastHorizonsTelemetryCache.checkedAt < cacheTtlMs) {
    return {
      status: "live",
      source: lastHorizonsTelemetryCache.value.source,
      updatedAt: lastHorizonsTelemetryCache.value.updatedAt,
      note: "Telemetry connected.",
      parsed: lastHorizonsTelemetryCache.value.parsed
    };
  }

  const centerTime = new Date(nowIso);
  const start = new Date(centerTime.getTime() - 5 * 60 * 1000);
  const stop = new Date(centerTime.getTime() + 5 * 60 * 1000);
  const earthUrl = buildHorizonsVectorsUrl("-1024", "500@399", start, stop, "1 m");
  const moonUrl = buildHorizonsVectorsUrl("-1024", "500@301", start, stop, "1 m");

  // Keep vector requests serialized to avoid parallel telemetry fetches.
  const earthProbe = await fetchProbe(earthUrl, revalidateSeconds);
  const moonProbe = await fetchProbe(moonUrl, revalidateSeconds);

  const earthPoints = parseHorizonsProbePoints(earthProbe);
  const moonPoints = parseHorizonsProbePoints(moonProbe);
  const earthPoint = nearestHorizonsPoint(earthPoints, nowIso);
  const moonPoint = nearestHorizonsPoint(moonPoints, nowIso);

  const distanceEarthKm =
    earthPoint && [earthPoint.xKm, earthPoint.yKm, earthPoint.zKm].every((v) => Number.isFinite(v))
      ? Math.hypot(earthPoint.xKm, earthPoint.yKm, earthPoint.zKm)
      : null;
  const distanceMoonKm =
    moonPoint && [moonPoint.xKm, moonPoint.yKm, moonPoint.zKm].every((v) => Number.isFinite(v))
      ? Math.hypot(moonPoint.xKm, moonPoint.yKm, moonPoint.zKm)
      : null;
  const velocityKmh =
    earthPoint && [earthPoint.vxKmS, earthPoint.vyKmS, earthPoint.vzKmS].every((v) => Number.isFinite(v))
      ? Math.hypot(earthPoint.vxKmS, earthPoint.vyKmS, earthPoint.vzKmS) * 3600
      : null;

  const launchIso = ARTEMIS_II_LAUNCH_ISO || DEFAULT_ARTEMIS_II_LAUNCH_ISO;
  const missionElapsedRaw = elapsedFromLaunch(launchIso);

  const parsed: ArowTelemetryParsed = {
    missionElapsedRaw,
    velocityKmh,
    distanceEarthKm,
    distanceMoonKm,
    earthRangeKm: distanceEarthKm,
    orionXKm: earthPoint?.xKm ?? null,
    orionYKm: earthPoint?.yKm ?? null,
    orionZKm: earthPoint?.zKm ?? null
  };

  if (parsed.velocityKmh !== null || parsed.distanceEarthKm !== null || parsed.distanceMoonKm !== null) {
    const source = "JPL Horizons API (-1024 vectors; Earth+Moon centered)";
    lastHorizonsTelemetryCache.value = {
      parsed,
      source,
      updatedAt: nowIso
    };
    lastHorizonsTelemetryCache.checkedAt = nowMs;

    return {
      status: "live",
      source,
      updatedAt: nowIso,
      note: "Telemetry connected.",
      parsed
    };
  }

  if (lastHorizonsTelemetryCache.value) {
    return {
      status: "fallback",
      source: lastHorizonsTelemetryCache.value.source,
      updatedAt: lastHorizonsTelemetryCache.value.updatedAt,
      note: "Horizons delayed. Showing last known vectors.",
      parsed: lastHorizonsTelemetryCache.value.parsed
    };
  }

  return null;
}

async function fetchArowTelemetry(nowIso: string, revalidateSeconds = TELEMETRY_REFRESH_SECONDS): Promise<ArowTelemetryResult> {
  const horizonsTelemetry = await fetchHorizonsOrionTelemetry(nowIso, revalidateSeconds);
  if (horizonsTelemetry) return horizonsTelemetry;

  // Secondary fallback chain only when Horizons is unavailable.
  const gcsTelemetry = await fetchArowGcsTelemetry(nowIso, revalidateSeconds);
  if (gcsTelemetry) return gcsTelemetry;

  const missionFileTelemetry = await fetchArowMissionFileTelemetry(nowIso, revalidateSeconds);
  if (missionFileTelemetry) return missionFileTelemetry;

  const probe = await fetchProbe(SOURCE_URLS.artemisArow, revalidateSeconds);
  if (probe.ok) {
    const parsed = parseArowTelemetryFromPayload(probe.text);
    if (
      parsed.velocityKmh !== null ||
      parsed.distanceEarthKm !== null ||
      parsed.distanceMoonKm !== null ||
      parsed.missionElapsedRaw !== null
    ) {
      lastArowTelemetryCache.value = {
        parsed,
        source: SOURCE_URLS.artemisArow,
        updatedAt: nowIso
      };
      return {
        status: "fallback",
        source: SOURCE_URLS.artemisArow,
        updatedAt: nowIso,
        note: "Horizons unavailable. Using AROW fallback.",
        parsed
      };
    }
  }

  if (lastArowTelemetryCache.value) {
    return {
      status: "fallback",
      source: lastArowTelemetryCache.value.source,
      updatedAt: lastArowTelemetryCache.value.updatedAt,
      note: "Telemetry delayed. Showing last known values.",
      parsed: lastArowTelemetryCache.value.parsed
    };
  }

  return {
    status: "error",
    source: "Unavailable",
    updatedAt: null,
    note: "No telemetry source currently available.",
    parsed: {
      missionElapsedRaw: elapsedFromLaunch(ARTEMIS_II_LAUNCH_ISO || DEFAULT_ARTEMIS_II_LAUNCH_ISO),
      velocityKmh: null,
      distanceEarthKm: null,
      distanceMoonKm: null,
      earthRangeKm: null,
      orionXKm: null,
      orionYKm: null,
      orionZKm: null
    }
  };
}

type GcsObjectItem = {
  name?: string;
  updated?: string;
};

function secondsToElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${days}:${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseArowGcsTelemetryPayload(payload: string): ArowTelemetryParsed | null {
  try {
    const data = JSON.parse(payload) as Record<string, { Value?: string }>;
    const p = (id: number) => Number(data[`Parameter_${id}`]?.Value);
    const metSeconds = p(5001);

    // AROW runtime payload carries Orion ECI vectors in feet and feet/second (Parameter 2003-2011).
    const xFt = p(2003);
    const yFt = p(2004);
    const zFt = p(2005);
    const vxFtS = p(2009);
    const vyFtS = p(2010);
    const vzFtS = p(2011);

    const hasPosition = Number.isFinite(xFt) && Number.isFinite(yFt) && Number.isFinite(zFt);
    const hasVelocity = Number.isFinite(vxFtS) && Number.isFinite(vyFtS) && Number.isFinite(vzFtS);

    const xKm = Number.isFinite(xFt) ? (xFt * 0.3048) / 1000 : null;
    const yKm = Number.isFinite(yFt) ? (yFt * 0.3048) / 1000 : null;
    const zKm = Number.isFinite(zFt) ? (zFt * 0.3048) / 1000 : null;

    const earthRangeKm = hasPosition ? Math.hypot(xKm as number, yKm as number, zKm as number) : null;
    const distanceEarthKm = earthRangeKm === null ? null : Math.max(0, earthRangeKm - EARTH_RADIUS_KM);
    const velocityKmh = hasVelocity ? Math.hypot(vxFtS, vyFtS, vzFtS) * 1.09728 : null;

    return {
      missionElapsedRaw: Number.isFinite(metSeconds) ? secondsToElapsed(metSeconds) : null,
      velocityKmh: Number.isFinite(velocityKmh) ? velocityKmh : null,
      distanceEarthKm: Number.isFinite(distanceEarthKm) ? distanceEarthKm : null,
      distanceMoonKm: null,
      earthRangeKm: Number.isFinite(earthRangeKm) ? earthRangeKm : null,
      orionXKm: Number.isFinite(xKm) ? xKm : null,
      orionYKm: Number.isFinite(yKm) ? yKm : null,
      orionZKm: Number.isFinite(zKm) ? zKm : null
    };
  } catch {
    return null;
  }
}

async function fetchArowGcsTelemetry(
  nowIso: string,
  revalidateSeconds = TELEMETRY_REFRESH_SECONDS
): Promise<ArowTelemetryResult | null> {
  const primaryMetaUrl = `https://storage.googleapis.com/storage/v1/b/${AROW_GCS_BUCKET}/o/${encodeURIComponent(AROW_GCS_PRIMARY_OBJECT)}`;
  let mediaUrl: string | null = null;

  const primaryMetaProbe = await fetchProbe(primaryMetaUrl, revalidateSeconds);
  if (primaryMetaProbe.ok) {
    try {
      const primaryMeta = JSON.parse(primaryMetaProbe.text) as { mediaLink?: string; generation?: string };
      if (primaryMeta.mediaLink) {
        mediaUrl = primaryMeta.mediaLink;
      } else if (primaryMeta.generation) {
        mediaUrl = `${primaryMetaUrl}?alt=media&generation=${encodeURIComponent(primaryMeta.generation)}`;
      }
    } catch {
      mediaUrl = null;
    }
  }

  // If direct metadata lookup fails, fallback to listing the folder and taking the newest object.
  if (!mediaUrl) {
    const listUrl = `https://storage.googleapis.com/storage/v1/b/${AROW_GCS_BUCKET}/o?prefix=${encodeURIComponent(AROW_GCS_OCTOBER_PREFIX)}&maxResults=200`;
    const listProbe = await fetchProbe(listUrl, revalidateSeconds);
    if (!listProbe.ok) return null;

    let items: GcsObjectItem[] = [];
    try {
      const payload = JSON.parse(listProbe.text) as { items?: GcsObjectItem[] };
      items = payload.items ?? [];
    } catch {
      return null;
    }

    const fileItems = items
      .filter((item) => (item.name ?? "").endsWith(".txt"))
      .sort((a, b) => +new Date(b.updated ?? 0) - +new Date(a.updated ?? 0));
    const target = fileItems.find((item) => item.name === AROW_GCS_PRIMARY_OBJECT) ?? fileItems[0];
    if (!target?.name) return null;
    mediaUrl = `https://storage.googleapis.com/storage/v1/b/${AROW_GCS_BUCKET}/o/${encodeURIComponent(target.name)}?alt=media`;
  }

  if (!mediaUrl) return null;
  const mediaProbe = await fetchProbe(mediaUrl, revalidateSeconds);
  if (!mediaProbe.ok) return null;

  const parsed = parseArowGcsTelemetryPayload(mediaProbe.text);
  if (!parsed) return null;

  if (
    parsed.velocityKmh !== null ||
    parsed.distanceEarthKm !== null ||
    parsed.missionElapsedRaw !== null ||
    parsed.earthRangeKm !== null
  ) {
    lastArowTelemetryCache.value = {
      parsed,
      source: mediaUrl,
      updatedAt: nowIso
    };
    return {
      status: "live",
      source: mediaUrl,
      updatedAt: nowIso,
      note: "Telemetry connected.",
      parsed
    };
  }

  return null;
}

function extractMissionTelemetryFilesFromBuildData(raw: Uint8Array): string[] {
  const text = Buffer.from(raw).toString("latin1");
  const hits = text.match(/Orion_flight\d+_mission\.txt/gi) ?? [];
  const dedup = [...new Set(hits.map((x) => x.trim()))];
  return dedup.sort((a, b) => {
    const na = Number(a.match(/Orion_flight(\d+)_mission\.txt/i)?.[1] ?? "0");
    const nb = Number(b.match(/Orion_flight(\d+)_mission\.txt/i)?.[1] ?? "0");
    return nb - na;
  });
}

function sortMissionFilesByFlight(files: string[]): string[] {
  return [...new Set(files)].sort((a, b) => {
    const na = Number(a.match(/Orion_flight(\d+)_mission\.txt/i)?.[1] ?? "0");
    const nb = Number(b.match(/Orion_flight(\d+)_mission\.txt/i)?.[1] ?? "0");
    return nb - na;
  });
}

function extractArowMissionBasesFromBuildData(raw: Uint8Array): string[] {
  const text = Buffer.from(raw).toString("latin1");
  const hits = text.match(/https:\/\/[^ \n\r"'<>]*\/Orion\/mission\//gi) ?? [];
  const defaults = [
    "https://nasa-jsc-public.s3.us-east-1.amazonaws.com/Orion/mission/",
    "https://s3.us-east-1.amazonaws.com/nasa-jsc-public/Orion/mission/"
  ];
  return [...new Set([...hits.map((h) => h.trim()), ...defaults])];
}

function missionListUrlFromBase(base: string): string | null {
  try {
    const url = new URL(base);
    if (url.hostname === "nasa-jsc-public.s3.us-east-1.amazonaws.com") {
      return "https://nasa-jsc-public.s3.us-east-1.amazonaws.com/?list-type=2&prefix=Orion/mission/";
    }
    if (url.hostname === "s3.us-east-1.amazonaws.com") {
      return "https://s3.us-east-1.amazonaws.com/nasa-jsc-public/?list-type=2&prefix=Orion/mission/";
    }
  } catch {
    return null;
  }
  return null;
}

function parseMissionFilesFromS3ListXml(xml: string): string[] {
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  const names = keys
    .filter((k) => /Orion\/mission\/Orion_flight\d+_mission\.txt$/i.test(k))
    .map((k) => k.split("/").pop() as string);
  return sortMissionFilesByFlight(names);
}

async function discoverMissionFilesFromBucketListing(bases: string[], revalidateSeconds: number): Promise<string[]> {
  const listUrls = [...new Set(bases.map(missionListUrlFromBase).filter((v): v is string => Boolean(v)))];
  if (!listUrls.length) return [];

  const files: string[] = [];
  for (const listUrl of listUrls) {
    const probe = await fetchProbe(listUrl, revalidateSeconds);
    if (!probe.ok) continue;
    files.push(...parseMissionFilesFromS3ListXml(probe.text));
  }
  return sortMissionFilesByFlight(files);
}

async function discoverArowMissionFiles(): Promise<string[]> {
  const now = Date.now();
  if (arowMissionFilesCache.value && now - arowMissionFilesCache.checkedAt < 10 * 60_000) {
    return arowMissionFilesCache.value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(SOURCE_URLS.artemisArowBuildData, {
      next: { revalidate: 600 },
      headers: RUNTIME_HEADERS,
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    const raw = new Uint8Array(ab);
    const filesFromBuild = extractMissionTelemetryFilesFromBuildData(raw);
    const basesFromBuild = extractArowMissionBasesFromBuildData(raw);
    arowMissionBasesCache.value = basesFromBuild;
    arowMissionBasesCache.checkedAt = now;
    const filesFromList = await discoverMissionFilesFromBucketListing(basesFromBuild, 600);
    const merged = sortMissionFilesByFlight([...filesFromList, ...filesFromBuild]);
    arowMissionFilesCache.value = merged;
    arowMissionFilesCache.checkedAt = now;
    return merged;
  } catch {
    const knownBases = arowMissionBasesCache.value ?? [
      "https://nasa-jsc-public.s3.us-east-1.amazonaws.com/Orion/mission/",
      "https://s3.us-east-1.amazonaws.com/nasa-jsc-public/Orion/mission/"
    ];
    const fromList = await discoverMissionFilesFromBucketListing(knownBases, 600);
    const fallback = fromList.length ? fromList : arowMissionFilesCache.value ?? [];
    arowMissionFilesCache.value = fallback;
    arowMissionFilesCache.checkedAt = now;
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchArowMissionFileTelemetry(
  nowIso: string,
  revalidateSeconds = TELEMETRY_REFRESH_SECONDS
): Promise<ArowTelemetryResult | null> {
  const files = await discoverArowMissionFiles();
  const candidates = files.slice(0, 6);
  const bases = arowMissionBasesCache.value ?? [
    "https://nasa-jsc-public.s3.us-east-1.amazonaws.com/Orion/mission/",
    "https://s3.us-east-1.amazonaws.com/nasa-jsc-public/Orion/mission/"
  ];

  for (const file of candidates) {
    for (const base of bases) {
      const url = `${base}${file}`;
      const probe = await fetchProbe(url, revalidateSeconds);
      if (!probe.ok) continue;

      const parsed = parseArowTelemetryFromPayload(probe.text);
      if (
        parsed.velocityKmh !== null ||
        parsed.distanceEarthKm !== null ||
        parsed.distanceMoonKm !== null ||
        parsed.missionElapsedRaw !== null
      ) {
        lastArowTelemetryCache.value = {
          parsed,
          source: url,
          updatedAt: nowIso
        };
        return {
          status: "live",
          source: url,
          updatedAt: nowIso,
          note: "Telemetry connected.",
          parsed
        };
      }
    }
  }

  return null;
}

function parseHorizonsVectors(resultText: string): HorizonsPoint[] {
  const pattern =
    /(\d+\.\d+)\s*=\s*([^\n]+)\n\s*X\s*=\s*([-+0-9.E]+)\s*Y\s*=\s*([-+0-9.E]+)\s*Z\s*=\s*([-+0-9.E]+)\n\s*VX=\s*([-+0-9.E]+)\s*VY=\s*([-+0-9.E]+)\s*VZ=\s*([-+0-9.E]+)\n\s*LT=\s*([-+0-9.E]+)\s*RG=\s*([-+0-9.E]+)\s*RR=\s*([-+0-9.E]+)/g;

  const points: HorizonsPoint[] = [];

  for (const match of resultText.matchAll(pattern)) {
    const epoch = match[2].trim();
    points.push({
      epoch,
      xKm: Number(match[3]),
      yKm: Number(match[4]),
      zKm: Number(match[5]),
      vxKmS: Number(match[6]),
      vyKmS: Number(match[7]),
      vzKmS: Number(match[8]),
      rangeKm: Number(match[10])
    });
  }

  return points;
}

async function fetchHorizonsOrionTrackPoints() {
  const center = new Date();
  center.setUTCMinutes(0, 0, 0);
  const start = new Date(center.getTime() - 24 * 60 * 60 * 1000);
  const stop = new Date(center.getTime() + 48 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    format: "json",
    COMMAND: "'-1024'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@399'",
    START_TIME: `'${start.toISOString().slice(0, 16).replace("T", " ")}'`,
    STOP_TIME: `'${stop.toISOString().slice(0, 16).replace("T", " ")}'`,
    STEP_SIZE: "'20 m'"
  });

  const url = `${SOURCE_URLS.horizons}?${params.toString()}`;
  const probe = await fetchProbe(url);

  if (!probe.ok) {
    return {
      status: "error" as SourceStatus,
      source: url,
      detail: "Orion trajectory vectors unavailable.",
      points: [] as HorizonsPoint[]
    };
  }

  try {
    const payload = JSON.parse(probe.text) as { result?: string; error?: string };
    if (payload.error) {
      return {
        status: "error" as SourceStatus,
        source: url,
        detail: "Orion trajectory vectors unavailable.",
        points: [] as HorizonsPoint[]
      };
    }

    const points = parseHorizonsVectors(payload.result ?? "");
    return {
      status: points.length ? ("live" as SourceStatus) : ("fallback" as SourceStatus),
      source: url,
      detail: points.length ? `Loaded ${points.length} Orion trajectory vectors.` : "Orion trajectory vectors unavailable.",
      points
    };
  } catch {
    return {
      status: "error" as SourceStatus,
      source: url,
      detail: "Orion trajectory vectors unavailable.",
      points: [] as HorizonsPoint[]
    };
  }
}

async function fetchHorizonsMoonTrackPoints() {
  const center = new Date();
  center.setUTCMinutes(0, 0, 0);
  const start = new Date(center.getTime() - 24 * 60 * 60 * 1000);
  const stop = new Date(center.getTime() + 48 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    format: "json",
    COMMAND: "'301'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@399'",
    START_TIME: `'${start.toISOString().slice(0, 16).replace("T", " ")}'`,
    STOP_TIME: `'${stop.toISOString().slice(0, 16).replace("T", " ")}'`,
    STEP_SIZE: "'20 m'"
  });

  const url = `${SOURCE_URLS.horizons}?${params.toString()}`;
  const probe = await fetchProbe(url);

  if (!probe.ok) {
    return {
      status: "error" as SourceStatus,
      source: url,
      detail: "Moon trajectory vectors unavailable.",
      points: [] as HorizonsPoint[]
    };
  }

  try {
    const payload = JSON.parse(probe.text) as { result?: string; error?: string };
    if (payload.error) {
      return {
        status: "error" as SourceStatus,
        source: url,
        detail: "Moon trajectory vectors unavailable.",
        points: [] as HorizonsPoint[]
      };
    }

    const points = parseHorizonsVectors(payload.result ?? "");
    return {
      status: points.length ? ("live" as SourceStatus) : ("fallback" as SourceStatus),
      source: url,
      detail: points.length ? `Loaded ${points.length} Moon trajectory vectors.` : "Moon trajectory vectors unavailable.",
      points
    };
  } catch {
    return {
      status: "error" as SourceStatus,
      source: url,
      detail: "Moon trajectory vectors unavailable.",
      points: [] as HorizonsPoint[]
    };
  }
}

function elapsedFromLaunch(launchIso: string | null): string | null {
  if (!launchIso) return null;

  const launchMs = new Date(launchIso).getTime();
  if (Number.isNaN(launchMs)) return null;

  const deltaSec = Math.max(0, Math.floor((Date.now() - launchMs) / 1000));
  const days = Math.floor(deltaSec / 86400);
  const hours = Math.floor((deltaSec % 86400) / 3600);
  const minutes = Math.floor((deltaSec % 3600) / 60);
  const seconds = deltaSec % 60;
  return `${days}:${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resolveMoonReferenceKm(points: HorizonsPoint[]): number {
  const firstFinite = points.find((point) => typeof point.rangeKm === "number" && Number.isFinite(point.rangeKm));
  if (!firstFinite || firstFinite.rangeKm === null) return FALLBACK_MOON_DISTANCE_KM;
  return Math.max(1, Math.round(firstFinite.rangeKm));
}

function resolveMoonVector(points: HorizonsPoint[], targetIso: string): { xKm: number; yKm: number; zKm: number } | null {
  if (!points.length) return null;
  const targetMs = new Date(targetIso).getTime();
  const nearest = points.reduce<{ point: HorizonsPoint; delta: number } | null>((best, point) => {
    const ms = new Date(point.epoch).getTime();
    if (!Number.isFinite(ms)) return best;
    const delta = Math.abs(ms - targetMs);
    if (!best || delta < best.delta) return { point, delta };
    return best;
  }, null);
  if (!nearest) return null;
  const { xKm, yKm, zKm } = nearest.point;
  if (![xKm, yKm, zKm].every((v) => Number.isFinite(v))) return null;
  return { xKm, yKm, zKm };
}

function valueOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round2(value: number | null): number | null {
  if (value === null) return null;
  return Number(value.toFixed(2));
}

function elapsedRawToSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const value = raw.trim();

  const dHms = value.match(/^(\d+):(\d{2}):(\d{2}):(\d{2})$/);
  if (dHms) {
    const [, d, h, m, s] = dHms;
    return Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
  }

  const hms = value.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) {
    const [, h, m, s] = hms;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }

  return null;
}

function metric(
  key: string,
  label: string,
  value: number | string | null,
  unit: string,
  status: SourceStatus,
  source: string,
  updatedAt: string | null,
  note?: string
): TelemetryMetric {
  return {
    key,
    label,
    value,
    unit,
    status,
    source,
    updatedAt,
    note
  };
}

function buildTelemetryMetrics(fetchedAt: string, arow: ArowTelemetryResult, context: TelemetryContext) {
  const prelaunch = context.launchIso === null;
  const launchElapsed = elapsedFromLaunch(context.launchIso);

  const missionElapsedRaw =
    arow.parsed.missionElapsedRaw ??
    context.updateTelemetry.missionElapsedRaw ??
    launchElapsed ??
    (prelaunch ? "00:00:00:00" : null);

  let velocityKmh =
    valueOrNull(arow.parsed.velocityKmh) ??
    valueOrNull(context.updateTelemetry.velocityKmh) ??
    (prelaunch ? 0 : null);

  let distanceEarthKm =
    valueOrNull(arow.parsed.distanceEarthKm) ??
    valueOrNull(context.updateTelemetry.distanceEarthKm) ??
    (prelaunch ? 0 : null);

  let distanceMoonKm =
    valueOrNull(arow.parsed.distanceMoonKm) ??
    valueOrNull(context.updateTelemetry.distanceMoonKm) ??
    (prelaunch ? context.moonReferenceKm : null);

  if (
    distanceMoonKm === null &&
    context.moonVector &&
    arow.parsed.orionXKm !== null &&
    arow.parsed.orionYKm !== null &&
    arow.parsed.orionZKm !== null
  ) {
    distanceMoonKm = Math.hypot(
      context.moonVector.xKm - arow.parsed.orionXKm,
      context.moonVector.yKm - arow.parsed.orionYKm,
      context.moonVector.zKm - arow.parsed.orionZKm
    );
  }

  if (distanceMoonKm === null && arow.parsed.earthRangeKm !== null) {
    // Scalar fallback when Moon vector is unavailable.
    distanceMoonKm = Math.max(0, context.moonReferenceKm - arow.parsed.earthRangeKm);
  }

  if (distanceEarthKm === null && distanceMoonKm !== null) {
    distanceEarthKm = Math.max(0, context.moonReferenceKm - distanceMoonKm);
  } else if (distanceMoonKm === null && distanceEarthKm !== null) {
    distanceMoonKm = Math.max(0, context.moonReferenceKm - distanceEarthKm);
  }

  if (velocityKmh === null && distanceEarthKm !== null) {
    const elapsedSeconds = elapsedRawToSeconds(missionElapsedRaw);
    if (elapsedSeconds && elapsedSeconds > 0) {
      velocityKmh = (distanceEarthKm / elapsedSeconds) * 3600;
    }
  }

  const fallbackSource = prelaunch ? "Pre-launch baseline (Orion at Earth)" : context.updateTelemetry.source;
  const fallbackUpdatedAt = context.updateTelemetry.updatedAt ?? context.updatedAt;

  const missionElapsedMetric = metric(
    "mission_elapsed",
    "Mission Elapsed",
    missionElapsedRaw,
    "",
    arow.parsed.missionElapsedRaw ? "live" : "fallback",
    arow.parsed.missionElapsedRaw ? arow.source : missionElapsedRaw ? fallbackSource : "Unavailable",
    arow.parsed.missionElapsedRaw ? arow.updatedAt : missionElapsedRaw ? fallbackUpdatedAt : null,
    arow.parsed.missionElapsedRaw ? undefined : prelaunch ? "Awaiting launch; showing baseline timer." : "Derived from latest official data."
  );

  const velocityMetric = metric(
    "velocity",
    "Velocity",
    round2(velocityKmh),
    "km/h",
    arow.parsed.velocityKmh !== null ? "live" : velocityKmh !== null ? "fallback" : "error",
    arow.parsed.velocityKmh !== null ? arow.source : velocityKmh !== null ? fallbackSource : "Unavailable",
    arow.parsed.velocityKmh !== null ? arow.updatedAt : velocityKmh !== null ? fallbackUpdatedAt : null,
    arow.parsed.velocityKmh !== null ? undefined : prelaunch ? "Baseline before mission launch." : "Live feed delayed; fallback in use."
  );

  const distanceEarthMetric = metric(
    "distance_earth",
    "Distance from Earth",
    round2(distanceEarthKm),
    "km",
    arow.parsed.distanceEarthKm !== null ? "live" : distanceEarthKm !== null ? "fallback" : "error",
    arow.parsed.distanceEarthKm !== null ? arow.source : distanceEarthKm !== null ? fallbackSource : "Unavailable",
    arow.parsed.distanceEarthKm !== null ? arow.updatedAt : distanceEarthKm !== null ? fallbackUpdatedAt : null,
    arow.parsed.distanceEarthKm !== null ? undefined : prelaunch ? "Baseline before mission launch." : "Live feed delayed; fallback in use."
  );

  const distanceMoonMetric = metric(
    "distance_moon",
    "Distance to Moon",
    round2(distanceMoonKm),
    "km",
    arow.parsed.distanceMoonKm !== null ? "live" : distanceMoonKm !== null ? "fallback" : "error",
    arow.parsed.distanceMoonKm !== null ? arow.source : distanceMoonKm !== null ? fallbackSource : "Unavailable",
    arow.parsed.distanceMoonKm !== null ? arow.updatedAt : distanceMoonKm !== null ? fallbackUpdatedAt : null,
    arow.parsed.distanceMoonKm !== null ? undefined : prelaunch ? "Baseline before mission launch." : "Live feed delayed; fallback in use."
  );

  const hasTelemetryValues =
    missionElapsedMetric.value !== null ||
    velocityMetric.value !== null ||
    distanceEarthMetric.value !== null ||
    distanceMoonMetric.value !== null;

  const hasLiveTelemetry =
    velocityMetric.status === "live" || distanceEarthMetric.status === "live" || distanceMoonMetric.status === "live";

  const trackingNote = hasLiveTelemetry
    ? "Telemetry connected."
    : hasTelemetryValues
      ? "Live telemetry delayed; fallback values are shown."
      : "Live telemetry unavailable.";

  return {
    missionElapsedMetric,
    velocityMetric,
    distanceEarthMetric,
    distanceMoonMetric,
    hasTelemetryValues,
    hasLiveTelemetry,
    trackingNote,
    fetchedAt
  };
}

function telemetrySourceStatus(telemetry: DashboardSnapshot["telemetry"]): SourceStatus {
  const statuses = [telemetry.velocity.status, telemetry.distanceEarth.status, telemetry.distanceMoon.status];
  if (statuses.includes("live")) return "live";

  const hasValues =
    telemetry.velocity.value !== null || telemetry.distanceEarth.value !== null || telemetry.distanceMoon.value !== null;
  return hasValues ? "fallback" : "error";
}

function buildCompactSources(snapshot: {
  telemetry: DashboardSnapshot["telemetry"];
  updates: MissionUpdate[];
  updatesSecondary: MissionUpdate[];
  fetchedAt: string;
}): SourceHealth[] {
  const telemetryStatus = telemetrySourceStatus(snapshot.telemetry);
  const eventFeedConnected = snapshot.updates.length > 0 || snapshot.updatesSecondary.length > 0;
  const videoConnected = Boolean(parseYoutubeId(SOURCE_URLS.broadcast)) && Boolean(parseYoutubeId(SOURCE_URLS.orionViews));

  return [
    {
      id: "status-telemetry",
      label: "Telemetry",
      url: SOURCE_URLS.trackArtemis,
      kind: "official tracking source",
      tier: "live",
      status: telemetryStatus,
      checkedAt: snapshot.fetchedAt,
      latencyMs: null,
      detail: telemetryStatus === "live" ? "Connected" : telemetryStatus === "fallback" ? "Fallback" : "Error"
    },
    {
      id: "status-events",
      label: "Event Feed",
      url: SOURCE_URLS.missionBlogFeed,
      kind: "official updates source",
      tier: "delayed",
      status: eventFeedConnected ? "live" : "error",
      checkedAt: snapshot.fetchedAt,
      latencyMs: null,
      detail: eventFeedConnected ? "Connected" : "Error"
    },
    {
      id: "status-video",
      label: "Video",
      url: SOURCE_URLS.broadcast,
      kind: "official live source",
      tier: "live",
      status: videoConnected ? "live" : "error",
      checkedAt: snapshot.fetchedAt,
      latencyMs: null,
      detail: videoConnected ? "Embedded" : "Error"
    }
  ];
}

function getFallbackContext(): TelemetryContext {
  return (
    lastTelemetryContextCache.value ?? {
      launchIso: null,
      phase: "MISSION ACTIVE",
      updateTelemetry: {
        missionElapsedRaw: null,
        velocityKmh: null,
        distanceEarthKm: null,
        distanceMoonKm: null,
        source: "NASA official Artemis II updates",
        updatedAt: null
      },
      moonReferenceKm: FALLBACK_MOON_DISTANCE_KM,
      moonVector: null,
      updatedAt: new Date().toISOString()
    }
  );
}

export async function getTelemetrySnapshot(): Promise<TelemetrySnapshot> {
  const fetchedAt = new Date().toISOString();
  const context = getFallbackContext();
  const arowTelemetry = await fetchArowTelemetry(fetchedAt);
  const telemetry = buildTelemetryMetrics(fetchedAt, arowTelemetry, context);

  return {
    fetchedAt,
    missionStartIso: context.launchIso,
    missionPhase: {
      value: context.phase,
      status: telemetry.hasLiveTelemetry ? "live" : "fallback",
      source: telemetry.hasLiveTelemetry ? SOURCE_URLS.trackArtemis : context.updateTelemetry.source,
      updatedAt: telemetry.velocityMetric.updatedAt ?? context.updatedAt
    },
    telemetry: {
      missionElapsed: telemetry.missionElapsedMetric,
      velocity: telemetry.velocityMetric,
      distanceEarth: telemetry.distanceEarthMetric,
      distanceMoon: telemetry.distanceMoonMetric
    },
    tracking: {
      artemisLiveAvailable: telemetry.hasTelemetryValues,
      artemisLiveNote: telemetry.trackingNote,
      artemisTrackerUrl: SOURCE_URLS.artemisArow,
      points: [],
      moonPoints: [],
      pointsStatus: "fallback",
      pointsSource: "JPL Horizons Moon vectors"
    }
  };
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const fetchedAt = new Date().toISOString();
  const tvBroadcast = getTvBroadcastSchedule();

  const [feedProbe, missionProbe, wpProbe, dsnContext, moonTrack, orionTrack, telemetryFast] = await Promise.all([
    fetchProbe(SOURCE_URLS.missionBlogFeed),
    fetchProbe(SOURCE_URLS.artemisMission),
    fetchProbe(SOURCE_URLS.artemisWpPosts),
    fetchDsnNowContext(),
    fetchHorizonsMoonTrackPoints(),
    fetchHorizonsOrionTrackPoints(),
    fetchArowTelemetry(fetchedAt, REFRESH_SECONDS)
  ]);

  const updates = feedProbe.ok ? parseMissionUpdates(feedProbe.text) : [];
  const updatesSecondary = wpProbe.ok ? parseWpArtemisUpdates(wpProbe.text) : [];
  const allOfficialUpdates = [...updates, ...updatesSecondary].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));

  const launchIso = ARTEMIS_II_LAUNCH_ISO;
  const phase = derivePhase(allOfficialUpdates, lastTelemetryContextCache.value?.phase);
  const updatesTelemetryFallback = extractTelemetryFromUpdates(allOfficialUpdates);

  const telemetryContext: TelemetryContext = {
    launchIso,
    phase,
    updateTelemetry: updatesTelemetryFallback,
    moonReferenceKm: resolveMoonReferenceKm(moonTrack.points),
    moonVector: resolveMoonVector(moonTrack.points, fetchedAt),
    updatedAt: fetchedAt
  };
  lastTelemetryContextCache.value = telemetryContext;

  const telemetry = buildTelemetryMetrics(fetchedAt, telemetryFast, telemetryContext);

  const snapshot: DashboardSnapshot = {
    fetchedAt,
    refreshSeconds: REFRESH_SECONDS,
    missionStartIso: launchIso,
    missionPhase: {
      value: phase,
      status: allOfficialUpdates.length ? "live" : "fallback",
      source: updates.length ? "NASA Missions Blog" : updatesSecondary.length ? "NASA Artemis II News" : SOURCE_URLS.artemisUpdates,
      updatedAt: allOfficialUpdates[0]?.timestamp ?? null
    },
    telemetry: {
      missionElapsed: telemetry.missionElapsedMetric,
      velocity: telemetry.velocityMetric,
      distanceEarth: telemetry.distanceEarthMetric,
      distanceMoon: telemetry.distanceMoonMetric
    },
    comms: {
      status: dsnContext.status,
      source: dsnContext.source,
      checkedAt: dsnContext.checkedAt,
      note: dsnContext.note,
      activeDishes: dsnContext.activeDishes,
      activeSignals: dsnContext.activeSignals,
      artemisTracked: dsnContext.artemisTracked
    },
    tracking: {
      artemisLiveAvailable: telemetry.hasTelemetryValues,
      artemisLiveNote: telemetry.trackingNote,
      artemisTrackerUrl: SOURCE_URLS.artemisArow,
      points: orionTrack.points,
      moonPoints: moonTrack.points,
      pointsStatus: orionTrack.status === "live" || moonTrack.status === "live" ? "live" : orionTrack.status,
      pointsSource: `Orion: ${orionTrack.source} | Moon: ${moonTrack.source}`
    },
    streams: {
      officialBroadcast: SOURCE_URLS.broadcast,
      orionViews: SOURCE_URLS.orionViews,
      nasaLiveHub: SOURCE_URLS.nasaLiveHub
    },
    updates: updates.slice(0, 15),
    updatesSecondary: updatesSecondary.slice(0, 12),
    tvBroadcast,
    sources: []
  };

  snapshot.sources = buildCompactSources(snapshot);

  if (!missionProbe.ok && snapshot.missionPhase.status === "live") {
    snapshot.missionPhase.status = "fallback";
  }

  return snapshot;
}

// Backward-compatible alias for older imports during dev-cache transitions.
export async function getMissionSnapshot() {
  return getDashboardSnapshot();
}
