import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/nasa";

export const revalidate = 30;

export async function GET() {
  try {
    const snapshot = await getDashboardSnapshot();
    return NextResponse.json({
      fetchedAt: snapshot.fetchedAt,
      updates: snapshot.updates
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "mission_updates_unavailable",
        message: error instanceof Error ? error.message : "Unknown mission updates error"
      },
      { status: 503 }
    );
  }
}
