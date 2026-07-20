import { getCurrentUser } from "@/lib/auth";
import { deleteReport } from "@/lib/db/repository";

export async function DELETE(_request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { reportId } = await params;
  const report = await deleteReport(user.id, reportId);
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
