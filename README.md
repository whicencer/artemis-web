# 🚀 Artemis II Mission Control Dashboard

A real-time, high-performance mission control interface for tracking NASA’s Artemis II flight — built for clarity, speed, and visual impact.

This is not just a data dashboard.  
It’s a live, interactive view of a human spaceflight mission.

---

## 🌌 What is this?

A futuristic web app that visualizes the Artemis II mission in real time:

- Where Orion is right now  
- How fast it’s moving  
- How far it is from Earth and the Moon  
- What phase the mission is in  
- What’s happening next  

All in a clean, fast, mission-control-style UI.

---

## ⚡ Key Features

### 🛰 Real-Time Telemetry (Horizons-based)
- Distance to Earth & Moon
- Velocity / Orion speed
- Derived trajectory data from JPL Horizons vectors
- Smooth updates + fallback system (never breaks)

### 🌕 Trajectory Visualization
- Earth → Orion → Moon track
- Live position with animated motion
- Progress-based rendering (completed vs remaining path)

### ⏱ Mission Elapsed Timer
- Client-side accurate timer
- Based on canonical launch timestamp
- Updates every second

### 🧠 Mission Phase Detection
- Derived from official NASA updates
- Multi-layer logic (updates → telemetry → fallback)
- Stable and human-readable phases

### 📡 Live Broadcast Integration
- Primary NASA broadcast
- Orion live views
- Clean UI with fullscreen + audio control

### 📺 TV Broadcast Console
- Parsed from official XLS schedule
- Shows:
  - LIVE NOW
  - UPCOMING EVENTS
  - FULL TIMELINE
- Countdown to next events

### 🔄 Smart Data Refresh System
- Telemetry: every 10s
- Event feed: every 30s
- Independent polling (no UI freezes)

---

## 🔥 Viral Features

Designed for shareability:

- 🌕 Time to Moon (dynamic countdown)
- 📊 Mission progress %
- 🚀 Speed comparisons (Orion vs real-world objects)
- 📍 “Where is Orion right now” simplified view
- 📱 Clip-ready UI blocks

---

## 🧠 Data Sources

- JPL Horizons (primary telemetry source)
- NASA official mission updates
- NASA TV broadcast schedule (XLS)
- YouTube live streams (NASA)

No fragile scraping.  
No fake endpoints.  
Everything derived or computed properly.

---

## ⚙️ Tech Stack

- **Next.js (App Router)**
- **TypeScript**
- **React**
- **Turbopack**
- CSS (custom / utility-first approach)

Optimized for:
- performance
- smooth updates
- responsive UI

---

## 🎯 Philosophy

Most space dashboards show raw data.  
This project focuses on:

> making complex spaceflight understandable and engaging.

- Less noise  
- More meaning  
- Real-time feeling  

---

## 🚀 Running Locally

```bash
npm install
npm run dev