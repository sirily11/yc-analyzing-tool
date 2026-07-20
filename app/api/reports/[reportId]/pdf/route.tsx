import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/auth";
import { getReport } from "@/lib/db/repository";
import { ReportPdf } from "@/lib/pdf/report-document";
import { loadYcCompanies } from "@/lib/yc/companies";

export const maxDuration = 30;

export async function GET(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser(); if (!user) return new Response("Not found", { status: 404 });
  const { reportId } = await params; const row = await getReport(user.id, reportId);
  if (!row || row.status !== "complete" || !row.document) return new Response("Not found", { status: 404 });
  const companies = await loadYcCompanies();
  const buffer = await renderToBuffer(<ReportPdf report={row.document} companies={companies} />);
  const filenameBase = String(row.document.profile.companyName ?? "report").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "report";
  const filename = `${filenameBase}-application-signal.pdf`;
  return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
}
