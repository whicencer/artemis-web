import { DashboardClient } from "@/components/DashboardClient";
import { getDashboardSnapshot } from "@/lib/nasa";

export const revalidate = 30;
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getDashboardSnapshot();
  return <DashboardClient initial={snapshot} />;
}
