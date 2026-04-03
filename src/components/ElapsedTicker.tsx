"use client";

import { useMemo } from "react";
import { useSecondNow } from "@/lib/clock";

function toInt(value: string | undefined): number {
  if (!value) return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function parseElapsedSeconds(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? Math.max(0, Math.floor(input)) : null;

  const value = input.trim();

  const dHms = value.match(/^(\d+):(\d{2}):(\d{2}):(\d{2})$/);
  if (dHms) {
    const [, d, h, m, s] = dHms;
    return toInt(d) * 86400 + toInt(h) * 3600 + toInt(m) * 60 + toInt(s);
  }

  const hms = value.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) {
    const [, h, m, s] = hms;
    return toInt(h) * 3600 + toInt(m) * 60 + toInt(s);
  }

  const dhm = value.match(/(\d+)\s*d(?:ays?)?\s*(\d+)\s*h(?:ours?)?\s*(\d+)\s*m(?:in(?:utes?)?)?/i);
  if (dhm) {
    const [, d, h, m] = dhm;
    return toInt(d) * 86400 + toInt(h) * 3600 + toInt(m) * 60;
  }

  const digitsOnly = value.match(/^\d+$/);
  if (digitsOnly) return toInt(value);

  return null;
}

function pad2(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(2, "0");
}

export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${pad2(days)}:${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
}

type ElapsedTickerProps = {
  value: string | number | null | undefined;
  anchorIso?: string | null;
  className?: string;
};

export function ElapsedTicker({ value, anchorIso, className }: ElapsedTickerProps) {
  const baseSeconds = useMemo(() => parseElapsedSeconds(value), [value]);
  const anchorMs = useMemo(() => {
    if (!anchorIso) return null;
    const parsed = new Date(anchorIso).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }, [anchorIso]);
  const now = useSecondNow();

  const currentSeconds = useMemo(() => {
    if (anchorMs !== null && now !== 0) {
      return Math.max(0, Math.floor((now - anchorMs) / 1000));
    }
    return baseSeconds;
  }, [anchorMs, baseSeconds, now]);

  const display = currentSeconds === null ? (typeof value === "string" && value.trim() ? value : "Unavailable") : formatElapsed(currentSeconds);
  return <span className={className}>{display}</span>;
}
