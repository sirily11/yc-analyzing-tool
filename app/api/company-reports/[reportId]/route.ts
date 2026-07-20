import { getCurrentUser } from "@/lib/auth";
import { deleteCompanyResearchReport, getCompanyResearchReport } from "@/lib/db/repository";

export async function GET(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { reportId } = await params;
  const report = await getCompanyResearchReport(user.id, reportId);
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  return Response.json({ status: report.status, title: report.title }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { reportId } = await params;
  const report = await deleteCompanyResearchReport(user.id, reportId);
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
