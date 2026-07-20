import "server-only";

import { appConfig } from "@/config";
import { buildCompanyResearchDraft } from "@/lib/analysis/company-research";
import {
  completeCompanyResearchReport,
  createCompanyResearchReport,
  failCompanyResearchReport,
  getCompanyResearchReport,
  storeCompanyResearchDraft,
} from "@/lib/db/repository";
import {
  companyResearchDraftSchema,
  companyResearchMapInputSchema,
  companyResearchReportDocumentSchema,
  type CompanyClusterMap,
} from "@/lib/types/company-research";
import { getYcCompaniesByIds } from "@/lib/yc/companies";

export type CompanyResearchRunStage = "company_lookup" | "report_create" | "public_research" | "map_prepare" | "draft_store";

export class CompanyResearchRunError extends Error {
  constructor(
    readonly originalCause: unknown,
    readonly stage: CompanyResearchRunStage,
    readonly reportId?: string,
  ) {
    super(originalCause instanceof Error ? originalCause.message : "COMPANY_RESEARCH_FAILED", { cause: originalCause });
    this.name = "CompanyResearchRunError";
  }
}

export function defaultCompanyResearchRequest(companyName: string) {
  return `Create a cited private research report on ${companyName}. Analyze its product, customers, business model, public traction signals, founders, opportunities, risks, and important unknowns using its public YC profile and public website sources.`;
}

export async function startCompanyResearchRun(input: {
  userId: string;
  chatId: string;
  companyIds: number[];
  request: string;
  requestId?: string;
  signal?: AbortSignal;
}) {
  let stage: CompanyResearchRunStage = "company_lookup";
  let reportId: string | undefined;
  try {
    const uniqueIds = [...new Set(input.companyIds)];
    const companies = await getYcCompaniesByIds(uniqueIds);
    stage = "report_create";
    reportId = await createCompanyResearchReport({ userId: input.userId, chatId: input.chatId, request: input.request, companyIds: uniqueIds });
    stage = "public_research";
    const draft = await buildCompanyResearchDraft({
      companies,
      request: input.request,
      requestId: input.requestId,
      chatId: input.chatId,
      signal: input.signal,
    });
    const officialCompanyIds = new Set(draft.sources
      .filter((source) => source.kind === "official-site" && source.status === "ok")
      .map((source) => source.companyId));
    stage = "map_prepare";
    const mapInput = companyResearchMapInputSchema.parse({
      reportId,
      targets: draft.companies.map((company) => ({
        companyId: company.companyId,
        semanticText: company.semanticText,
        textSource: officialCompanyIds.has(company.companyId) ? "firecrawl" : "dataset",
      })),
    });
    stage = "draft_store";
    if (!await storeCompanyResearchDraft({ id: reportId, userId: input.userId, draft, mapInput })) {
      throw new Error("COMPANY_RESEARCH_NOT_STORABLE");
    }
    return { reportId, draft };
  } catch (cause) {
    if (reportId) {
      await failCompanyResearchReport(
        reportId,
        input.userId,
        cause instanceof Error ? cause.message.slice(0, 120) : "COMPANY_RESEARCH_FAILED",
      );
    }
    throw new CompanyResearchRunError(cause, stage, reportId);
  }
}

export async function publishCompanyResearchRun(input: {
  userId: string;
  chatId: string;
  reportId: string;
  map: CompanyClusterMap;
}) {
  const existing = await getCompanyResearchReport(input.userId, input.reportId);
  if (!existing || existing.chatId !== input.chatId || existing.status !== "mapping" || !existing.document) {
    throw new Error("COMPANY_REPORT_NOT_PUBLISHABLE");
  }
  if (input.map.modelVersion !== appConfig.modelVersion || input.map.datasetVersion !== appConfig.datasetVersion) {
    throw new Error("MODEL_VERSION_MISMATCH");
  }
  const targetIds = new Set(existing.companyIds);
  const mappedTargets = new Set(input.map.points.filter((point) => point.target).map((point) => point.companyId));
  if (targetIds.size !== mappedTargets.size || [...targetIds].some((id) => !mappedTargets.has(id))) {
    throw new Error("COMPANY_MAP_TARGET_MISMATCH");
  }
  const draft = companyResearchDraftSchema.parse(existing.document);
  const document = companyResearchReportDocumentSchema.parse({ ...draft, map: input.map });
  if (!await completeCompanyResearchReport({ id: input.reportId, userId: input.userId, map: input.map, document })) {
    throw new Error("COMPANY_REPORT_NOT_PUBLISHABLE");
  }
  return { reportId: input.reportId, href: `/company-reports/${input.reportId}`, document };
}
