import { getCurrentUser } from "@/lib/auth";
import { failCompanyResearchReport, getCompanyResearchReport } from "@/lib/db/repository";

export async function GET(_request: Request, context: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { reportId } = await context.params;
  const report = await getCompanyResearchReport(user.id, reportId);
  if (!report || report.status !== "mapping" || !report.mapInput) return Response.json({ error: "Report map input not found" }, { status: 404 });
  return Response.json(report.mapInput, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(_request: Request, context: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { reportId } = await context.params;
  const report = await getCompanyResearchReport(user.id, reportId);
  if (!report || report.status !== "mapping") return Response.json({ error: "Report map input not found" }, { status: 404 });
  await failCompanyResearchReport(reportId, user.id, "COMPANY_CLUSTER_MAP_FAILED");
  return new Response(null, { status: 204 });
}
