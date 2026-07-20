import "server-only";

import { start } from "workflow/api";
import { appConfig } from "@/config";
import {
  completeCompanyResearchReport,
  createCompanyResearchReport,
  failCompanyResearchReport,
  getCompanyResearchReport,
} from "@/lib/db/repository";
import { companyResearchDraftSchema, companyResearchReportDocumentSchema, type CompanyClusterMap } from "@/lib/types/company-research";
import { getYcCompaniesByIds } from "@/lib/yc/companies";
import { companyResearchWorkflow } from "@/workflows/company-research";
import { billingConfig, reserveWithMargin } from "@/lib/billing/config";
import { attachReservationScope, closeReservation, findOpenReservationByScope, reserveCredits } from "@/lib/billing/repository";

export type CompanyResearchRunStage = "company_lookup" | "report_create" | "workflow_start";

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
}) {
  let stage: CompanyResearchRunStage = "company_lookup";
  let reportId: string | undefined;
  const reservation = await reserveCredits({
    userId: input.userId,
    operationKey: `company-report:${input.userId}:${input.requestId ?? crypto.randomUUID()}`,
    feature: "Company research report",
    points: reserveWithMargin(billingConfig.companyResearchReservationPoints) + billingConfig.reportFeePoints,
    reportFeePoints: billingConfig.reportFeePoints,
  });
  try {
    const uniqueIds = [...new Set(input.companyIds)];
    await getYcCompaniesByIds(uniqueIds);
    stage = "report_create";
    reportId = await createCompanyResearchReport({ userId: input.userId, chatId: input.chatId, request: input.request, companyIds: uniqueIds });
    if (reservation) await attachReservationScope(reservation.id, input.userId, reportId);
    stage = "workflow_start";
    const run = await start(companyResearchWorkflow, [{
      userId: input.userId,
      chatId: input.chatId,
      reportId,
      companyIds: uniqueIds,
      request: input.request,
      requestId: input.requestId,
      reservationId: reservation?.id,
    }]);
    return { reportId, runId: run.runId };
  } catch (cause) {
    if (reportId) {
      await failCompanyResearchReport(
        reportId,
        input.userId,
        cause instanceof Error ? cause.message.slice(0, 120) : "COMPANY_RESEARCH_FAILED",
      );
    }
    if (reservation) await closeReservation({ reservationId: reservation.id, userId: input.userId, success: false, scopeId: reportId });
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
  const reservation = await findOpenReservationByScope(input.userId, input.reportId);
  if (reservation) await closeReservation({ reservationId: reservation.id, userId: input.userId, success: true, scopeId: input.reportId, chargeReportFee: true });
  return { reportId: input.reportId, href: `/company-reports/${input.reportId}`, document };
}
