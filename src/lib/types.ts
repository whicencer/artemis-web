export type SourceStatus = "live" | "fallback" | "error";

export type SourceKind =
  | "official tracking source"
  | "official updates source"
  | "official live source"
  | "official api source"
  | "official network source"
  | "official app source"
  | "reference source";

export type SourceTier = "live" | "delayed" | "reference";

export type SourceHealth = {
  id: string;
  label: string;
  url: string;
  kind: SourceKind;
  tier: SourceTier;
  status: SourceStatus;
  checkedAt: string;
  latencyMs: number | null;
  detail: string;
};

export type TelemetryMetric = {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  status: SourceStatus;
  source: string;
  updatedAt: string | null;
  note?: string;
};

export type MissionUpdate = {
  id: string;
  timestamp: string;
  title: string;
  summary: string;
  link: string;
  source: string;
};

export type TvBroadcastEvent = {
  id: string;
  startTime: string;
  endTime: string | null;
  title: string;
  description: string;
  metLabel: string | null;
  metSeconds: number | null;
};

export type HorizonsPoint = {
  epoch: string;
  xKm: number;
  yKm: number;
  zKm: number;
  vxKmS: number;
  vyKmS: number;
  vzKmS: number;
  rangeKm: number | null;
};

export type DashboardSnapshot = {
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
    missionElapsed: TelemetryMetric;
    velocity: TelemetryMetric;
    distanceEarth: TelemetryMetric;
    distanceMoon: TelemetryMetric;
  };
  comms: {
    status: SourceStatus;
    source: string;
    checkedAt: string;
    note: string;
    activeDishes: number;
    activeSignals: number;
    artemisTracked: boolean;
  };
  tracking: {
    artemisLiveAvailable: boolean;
    artemisLiveNote: string;
    artemisTrackerUrl: string;
    points: HorizonsPoint[];
    pointsStatus: SourceStatus;
    pointsSource: string;
  };
  streams: {
    officialBroadcast: string;
    orionViews: string;
    nasaLiveHub: string;
  };
  updates: MissionUpdate[];
  updatesSecondary: MissionUpdate[];
  tvBroadcast: {
    source: string;
    loadedAt: string | null;
    events: TvBroadcastEvent[];
  };
  sources: SourceHealth[];
};
