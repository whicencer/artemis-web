import { NextResponse } from "next/server";
import { getTelemetrySnapshot } from "@/lib/nasa";

export const revalidate = 10;

export async function GET() {
  try {
    const telemetry = await getTelemetrySnapshot();
    return NextResponse.json(telemetry);
  } catch (error) {
    return NextResponse.json(
      {
        error: "telemetry_unavailable",
        message: error instanceof Error ? error.message : "Unknown telemetry error"
      },
      { status: 503 }
    );
  }
}
