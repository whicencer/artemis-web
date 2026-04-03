#!/usr/bin/env node
/* global process, console */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const DEFAULT_XLS_PATH = "/Users/mac/Downloads/artemis-ii-tv-schedule-rev-a-1.xls";
const DEFAULT_OUT_PATH = path.resolve(process.cwd(), "public", "artemis-tv-schedule.json");

const inputPath = path.resolve(process.argv[2] || process.env.TV_BROADCAST_XLS_PATH || DEFAULT_XLS_PATH);
const outputPath = path.resolve(process.argv[3] || process.env.TV_BROADCAST_JSON_PATH || DEFAULT_OUT_PATH);

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11
};

function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function trimRight(row) {
  const clean = row.map(cleanCell);
  let end = clean.length;
  while (end > 0 && clean[end - 1] === "") end -= 1;
  return clean.slice(0, end);
}

function extractScheduleYear(rows) {
  for (const row of rows) {
    for (const cell of row) {
      const match = cell.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
      if (!match) continue;
      const yearRaw = Number(match[3]);
      if (!Number.isFinite(yearRaw)) continue;
      return yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    }
  }
  return new Date().getUTCFullYear();
}

function parseDateHeader(text, year) {
  const m = text.match(
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),\s+([a-z]+)\s+(\d{1,2})$/i
  );
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  const day = Number(m[3]);
  if (month === undefined || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function parseGmtTime(text) {
  const m = text.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseMet(metDay, metTime) {
  const joined = `${cleanCell(metDay)}${cleanCell(metTime)}`.replace(/\s+/g, "");
  const m = joined.match(/^(\d{1,3})\/(\d{1,2}):(\d{2})$/);
  if (!m) return { label: null, seconds: null };
  const day = Number(m[1]);
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (![day, hour, minute].every(Number.isFinite)) return { label: null, seconds: null };
  return {
    label: `${String(day).padStart(2, "0")}/${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    seconds: day * 86400 + hour * 3600 + minute * 60
  };
}

function parseScheduleEvents(rows) {
  const year = extractScheduleYear(rows);
  const events = [];
  let currentDate = null;
  let lastStartMs = null;

  rows.forEach((row, index) => {
    const first = cleanCell(row[0]);
    const headerDate = parseDateHeader(first, year);
    if (headerDate) {
      currentDate = headerDate;
      return;
    }
    if (!currentDate) return;

    const title = cleanCell(row[2]);
    const gmt = cleanCell(row[8]);
    if (!title || !gmt) return;
    const hm = parseGmtTime(gmt);
    if (!hm) return;

    let start = Date.UTC(currentDate.year, currentDate.month, currentDate.day, hm.hour, hm.minute, 0);
    if (lastStartMs !== null && start <= lastStartMs) start += 24 * 60 * 60 * 1000;

    const met = parseMet(cleanCell(row[4]), cleanCell(row[5]));
    const site = cleanCell(row[3]);
    const description = [site ? `Site: ${site}` : "", met.label ? `MET ${met.label}` : ""]
      .filter(Boolean)
      .join(" · ");

    events.push({
      id: `tv-${index}-${start}`,
      rowIndex: index,
      startTime: new Date(start).toISOString(),
      endTime: null,
      title,
      description,
      metLabel: met.label,
      metSeconds: met.seconds
    });
    lastStartMs = start;
  });

  events.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
  for (let i = 0; i < events.length; i += 1) {
    events[i].endTime = events[i + 1]?.startTime ?? null;
  }
  return events;
}

function parseWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rowsRaw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    const rows = rowsRaw.map((row) => trimRight(Array.isArray(row) ? row : []));
    const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    return {
      name,
      rowCount: rows.length,
      colCount,
      rows
    };
  });

  const missionScheduleSheet = sheets[0];
  const scheduleEvents = missionScheduleSheet ? parseScheduleEvents(missionScheduleSheet.rows) : [];
  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    sourceFile: filePath,
    workbook: {
      sheetCount: sheets.length,
      sheetNames: workbook.SheetNames,
      sheets
    },
    schedule: {
      source: `TV schedule XLS (${filePath})`,
      loadedAt: generatedAt,
      events: scheduleEvents
    }
  };
}

function main() {
  const payload = parseWorkbook(inputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Exported ${payload.schedule.events.length} events from ${inputPath}`);
  console.log(`Wrote ${outputPath}`);
}

main();
