import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { chatToolErrorMessage } from "@/lib/ai/chat-error";
import { summarizeToolError } from "@/lib/ai/tool-log";
import { CompanyResearchRunError, defaultCompanyResearchRequest, startCompanyResearchRun } from "@/lib/analysis/company-research-run";
import { getReport } from "@/lib/db/repository";
import { getYcCompaniesByIds } from "@/lib/yc/companies";

export const maxDuration = 60;

const requestSchema = z.object({
  sourceReportId: z.string().uuid(),
  companyId: z.number().int(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid company report request" }, { status: 400 });

  const sourceReport = await getReport(user.id, parsed.data.sourceReportId);
  if (!sourceReport || sourceReport.status !== "complete") {
    return Response.json({ error: "Source report not found" }, { status: 404 });
  }

  try {
    const [company] = await getYcCompaniesByIds([parsed.data.companyId]);
    const result = await startCompanyResearchRun({
      userId: user.id,
      chatId: sourceReport.chatId,
      companyIds: [company.id],
      request: defaultCompanyResearchRequest(company.name),
      requestId: randomUUID(),
      signal: request.signal,
    });
    return Response.json({ reportId: result.reportId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (runError) {
    const cause = runError instanceof CompanyResearchRunError ? runError.originalCause : runError;
    const summary = summarizeToolError(cause);
    console.error("Direct company report research failed", {
      sourceReportId: parsed.data.sourceReportId,
      companyId: parsed.data.companyId,
      stage: runError instanceof CompanyResearchRunError ? runError.stage : "company_lookup",
      reportId: runError instanceof CompanyResearchRunError ? runError.reportId : undefined,
      ...summary,
    });
    const status = summary.errorCode === "FIRECRAWL_NOT_CONFIGURED" || summary.errorCode === "FIRECRAWL_RESEARCH_UNAVAILABLE" ? 503 : 500;
    const toolMessage = chatToolErrorMessage(cause);
    const error = toolMessage === "The requested tool could not complete. Please retry from this conversation."
      ? "Public company research could not complete. Please try again."
      : toolMessage;
    return Response.json({ error }, { status });
  }
}
