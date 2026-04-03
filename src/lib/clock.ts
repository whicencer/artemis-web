"use client";

import { useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
let timer: number | null = null;
let nowMs = Date.now();

function start() {
  if (timer !== null || typeof window === "undefined") return;
  nowMs = Date.now();
  for (const listener of listeners) listener();
  timer = window.setInterval(() => {
    nowMs = Date.now();
    for (const listener of listeners) listener();
  }, 1000);
}

function stop() {
  if (timer === null || typeof window === "undefined") return;
  window.clearInterval(timer);
  timer = null;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stop();
  };
}

function getSnapshot() {
  return nowMs;
}

function getServerSnapshot() {
  return 0;
}

export function useSecondNow() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
