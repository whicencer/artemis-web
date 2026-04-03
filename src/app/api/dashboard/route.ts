import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/nasa";

export const revalidate = 30;

export async function GET() {
  try {
    const snapshot = await getDashboardSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      {
        error: "dashboard_unavailable",
        message: error instanceof Error ? error.message : "Unknown dashboard error"
      },
      { status: 503 }
    );
  }
}
