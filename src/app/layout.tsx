import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://artemis-mission-control.local"),
  title: "Artemis II Live Mission Control Dashboard",
  description:
    "High-performance real-time mission control dashboard for NASA Artemis II with official streams, telemetry ingestion, tracking context, and source health.",
  openGraph: {
    title: "Artemis II Live Mission Control Dashboard",
    description:
      "Live Artemis II command dashboard with telemetry status, tracking context, event log, and source health.",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Artemis II Live Mission Control Dashboard",
    description: "Real-time NASA Artemis II dashboard"
  },
  manifest: "/manifest.webmanifest"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
