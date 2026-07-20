import { buildCompanyResearchDraft } from "@/lib/analysis/company-research";
import {
  failCompanyResearchReport,
  getCompanyResearchReport,
  storeCompanyResearchDraft,
} from "@/lib/db/repository";
import { companyResearchMapInputSchema } from "@/lib/types/company-research";
import { getYcCompaniesByIds } from "@/lib/yc/companies";
import { closeReservation } from "@/lib/billing/repository";

export type CompanyResearchWorkflowInput = {
  userId: string;
  chatId: string;
  reportId: string;
  companyIds: number[];
  request: string;
  requestId?: string;
  reservationId?: string;
};

export async function researchCompanyReportStep(input: CompanyResearchWorkflowInput) {
  "use step";

  const companies = await getYcCompaniesByIds(input.companyIds);
  const draft = await buildCompanyResearchDraft({
    companies,
    request: input.request,
    requestId: input.requestId,
    chatId: input.chatId,
    timeoutMs: 5 * 60_000,
    userId: input.userId,
    reservationId: input.reservationId,
    operationId: input.reportId,
  });
  const officialCompanyIds = new Set(draft.sources
    .filter((source) => source.kind === "official-site" && source.status === "ok")
    .map((source) => source.companyId));
  const mapInput = companyResearchMapInputSchema.parse({
    reportId: input.reportId,
    targets: draft.companies.map((company) => ({
      companyId: company.companyId,
      semanticText: company.semanticText,
      textSource: officialCompanyIds.has(company.companyId) ? "firecrawl" : "dataset",
    })),
  });
  return { draft, mapInput };
}

export async function storeCompanyReportDraftStep(
  input: Pick<CompanyResearchWorkflowInput, "userId" | "reportId">,
  research: Awaited<ReturnType<typeof researchCompanyReportStep>>,
) {
  "use step";

  const stored = await storeCompanyResearchDraft({
    id: input.reportId,
    userId: input.userId,
    draft: research.draft,
    mapInput: research.mapInput,
  });
  if (stored) return;

  // A step can be delivered again after its first database write succeeds but
  // before Workflow records the result. Treat that mapping state as success.
  const existing = await getCompanyResearchReport(input.userId, input.reportId);
  if (existing?.status === "mapping") return;
  throw new Error("COMPANY_RESEARCH_NOT_STORABLE");
}

export async function failCompanyReportWorkflowStep(input: Pick<CompanyResearchWorkflowInput, "userId" | "reportId">, failureCode: string) {
  "use step";

  await failCompanyResearchReport(input.reportId, input.userId, failureCode.slice(0, 120));
}

export async function releaseCompanyReportReservationStep(input: Pick<CompanyResearchWorkflowInput, "userId" | "reportId" | "reservationId">) {
  "use step";
  if (input.reservationId) await closeReservation({ reservationId: input.reservationId, userId: input.userId, success: false, scopeId: input.reportId });
}

export async function companyResearchWorkflow(input: CompanyResearchWorkflowInput) {
  "use workflow";

  try {
    const research = await researchCompanyReportStep(input);
    await storeCompanyReportDraftStep(input, research);
    return { reportId: input.reportId, status: "mapping" as const };
  } catch (cause) {
    const failureCode = cause instanceof Error ? cause.message : "COMPANY_RESEARCH_FAILED";
    await failCompanyReportWorkflowStep(input, failureCode);
    await releaseCompanyReportReservationStep(input);
    throw cause;
  }
}
