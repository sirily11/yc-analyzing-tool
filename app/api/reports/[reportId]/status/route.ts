import { getCurrentUser } from "@/lib/auth";
import { reportResearchProgress } from "@/lib/research/report-research";

export const dynamic = "force-dynamic";

const privateNoStoreHeaders = { "Cache-Control": "private, no-store" };

export async function GET(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401, headers: privateNoStoreHeaders });
  const { reportId } = await params;
  const progress = await reportResearchProgress(user.id, reportId);
  return progress
    ? Response.json(progress, { headers: privateNoStoreHeaders })
    : Response.json({ error: "Report not found" }, { status: 404, headers: privateNoStoreHeaders });
}
