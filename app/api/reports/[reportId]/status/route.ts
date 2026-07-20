import { getCurrentUser } from "@/lib/auth";
import { reconcileReportResearch, reportResearchProgress } from "@/lib/research/report-research";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { reportId } = await params;
  const progress = await reportResearchProgress(user.id, reportId);
  return progress ? Response.json(progress) : Response.json({ error: "Report not found" }, { status: 404 });
}

export async function POST(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { reportId } = await params;
  const progress = await reconcileReportResearch(user.id, reportId);
  return progress ? Response.json(progress) : Response.json({ error: "Report not found" }, { status: 404 });
}
