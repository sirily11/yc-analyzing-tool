import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/auth";
import { getCompanyResearchReport } from "@/lib/db/repository";
import { CompanyResearchReportPdf } from "@/lib/pdf/company-report-document";
import { companyResearchReportDocumentSchema } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";

export const maxDuration = 30;

export async function GET(_: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { reportId } = await params;
  const row = await getCompanyResearchReport(user.id, reportId);
  const parsed = companyResearchReportDocumentSchema.safeParse(row?.document);
  if (!row || row.status !== "complete" || !parsed.success) return new Response("Not found", { status: 404 });

  const companies = JSON.parse(await readFile(path.join(process.cwd(), "public/data/yc-companies.json"), "utf8")) as YcCompany[];
  const buffer = await renderToBuffer(<CompanyResearchReportPdf report={parsed.data} companies={companies} />);
  const filenameBase = (parsed.data.companies.length === 1 ? parsed.data.companies[0].name : parsed.data.title)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "company-research";
  const filename = `${filenameBase}-company-research.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
