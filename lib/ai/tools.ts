import "server-only";
import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { appConfig } from "@/config";
import { questionInputSchema, questionOutputSchema } from "@/lib/ai/question";
import { categorizeApplication } from "@/lib/analysis/server";
import { CompanyResearchRunError, startCompanyResearchRun } from "@/lib/analysis/company-research-run";
import { generatedApplicationProfileSchema, predictionResultSchema, sourceFileMetadataSchema, type ExtractedPdf } from "@/lib/types/analysis";
import { createReport, failReport, getReadyChatDocument, getReport } from "@/lib/db/repository";
import { FirecrawlScrapeError } from "@/lib/firecrawl/client";
import { readRetainedDocument } from "@/lib/storage/chat-documents";
import { companySearchInputSchema, getYcCompaniesByIds, loadYcDatasetManifest, searchYcCompanies } from "@/lib/yc/companies";
import { fetchYcCompanyDetail } from "@/lib/yc/company-data";
import { confirmationInputSchema, stopInputSchema, type ConfirmationAction } from "@/lib/ai/chat-source";
import { chatToolLog, summarizeToolError } from "@/lib/ai/tool-log";
import { startReportResearch } from "@/lib/research/report-research";
import { billingConfig, reserveWithMargin } from "@/lib/billing/config";
import { attachReservationScope, closeReservation, reserveCredits } from "@/lib/billing/repository";
import { InsufficientCreditsError } from "@/lib/billing/errors";

const sourceFileSchema = sourceFileMetadataSchema.extend({ kind: z.literal("pdf").optional() });

const analysisSourceSchema = z.union([
  z.object({ sourceKind: z.literal("pdf").optional(), documentId: z.string().uuid(), sourceFile: sourceFileSchema, parentReportId: z.string().nullable().optional() }),
  z.object({ sourceKind: z.literal("chat"), title: z.string().min(1).max(80).optional(), parentReportId: z.string().nullable().optional() }),
]);

function companyResearchFailureResult(cause: unknown, stage: string, reportId: string | undefined) {
  const summary = summarizeToolError(cause);
  const scrapeErrors = cause instanceof FirecrawlScrapeError ? cause.failures.slice(0, 20) : [];
  const status = summary.errorCode.match(/:(\d{3})$/)?.[1];
  const message = cause instanceof InsufficientCreditsError
    ? `This report needs ${cause.requiredPoints.toLocaleString("en-US")} available points; ${cause.availablePoints.toLocaleString("en-US")} are available. Add points from the Credits page and try again.`
    : scrapeErrors.length > 0
    ? `Firecrawl failed to scrape ${scrapeErrors.length} requested public page${scrapeErrors.length === 1 ? "" : "s"}. Company research stopped before synthesis.`
    : summary.errorCode === "FIRECRAWL_NOT_CONFIGURED"
      ? "Firecrawl is not configured, so public company research could not start."
      : summary.errorCode === "FIRECRAWL_RESEARCH_UNAVAILABLE"
        ? "Firecrawl returned no usable public sources. Company research stopped before synthesis."
        : status
          ? `Firecrawl returned HTTP ${status}. Company research stopped before synthesis.`
          : "Company research failed before a report draft could be created.";
  const retryable = summary.errorCode === "TIMEOUT"
    || summary.errorCode === "FIRECRAWL_SCRAPE_FAILED"
    || summary.errorCode.endsWith(":408")
    || summary.errorCode.endsWith(":429")
    || /^FIRECRAWL_REQUEST_FAILED:5\d\d$/.test(summary.errorCode);
  return {
    ok: false as const,
    reportId: reportId ?? null,
    error: {
      code: summary.errorCode,
      message,
      stage,
      retryable,
      scrapeErrors,
      ...(cause instanceof InsufficientCreditsError ? { creditsUrl: "/credits", availablePoints: cause.availablePoints, requiredPoints: cause.requiredPoints } : {}),
    },
  };
}

export function createAnalysisTools(context: { userId: string; chatId: string; chatText: string | null; approvedActions: ReadonlySet<ConfirmationAction>; requestId: string; requestSignal?: AbortSignal; reservationId?: string | null }) {
  const approvedActions = new Set(context.approvedActions);
  return {
    askQuestion: tool({
      description: "Ask the user a question through a dedicated UI instead of asking in prose. Supports single-select (which always includes a custom free-form answer), multiple-select, and free-form questions.",
      inputSchema: questionInputSchema,
      outputSchema: questionOutputSchema,
    }),
    confirm: tool({
      description: "Ask the user for approval through a dedicated confirmation UI instead of asking in prose. The action is required and scopes the approval to exactly one downstream workflow.",
      inputSchema: confirmationInputSchema,
      needsApproval: true,
      execute: async () => ({ confirmed: true }),
    }),
    analyzeApplication: tool({
      description: "Categorize the user's own confirmed startup application from a PDF or typed chat brief. Never use this tool for public YC company lookup or company research, and never call it before application-analysis confirmation.",
      inputSchema: analysisSourceSchema,
      execute: async (input) => {
        if (!approvedActions.has("application-analysis")) throw new Error("ANALYSIS_CONFIRMATION_REQUIRED");
        approvedActions.delete("application-analysis");
        let source: ExtractedPdf;
        if (input.sourceKind !== "chat") {
          const document = await getReadyChatDocument(context.userId, context.chatId, input.documentId);
          if (!document || document.metadata.sha256 !== input.sourceFile.sha256) throw new Error("DOCUMENT_NOT_AVAILABLE");
          source = await readRetainedDocument(document);
        } else {
          const text = context.chatText?.trim();
          if (!text || text.length < 20) throw new Error("CHAT_DESCRIPTION_NOT_AVAILABLE");
          const name = input.title?.trim() || "Conversation brief";
          source = {
            metadata: {
              kind: "chat",
              name,
              size: new TextEncoder().encode(text).byteLength,
              pages: 1,
              characters: text.length,
              sha256: createHash("sha256").update(text).digest("hex"),
            },
            pages: [{ page: 1, text }],
            text,
          };
        }

        const reservation = await reserveCredits({
          userId: context.userId,
          operationKey: `application-report:${context.userId}:${context.requestId}`,
          feature: "Application report",
          points: reserveWithMargin(billingConfig.applicationReservationPoints) + billingConfig.reportFeePoints,
          reportFeePoints: billingConfig.reportFeePoints,
        });
        const title = `${source.metadata.name.replace(/\.pdf$/i, "")} · Analysis`;
        let reportId: string;
        try {
          reportId = await createReport({ userId: context.userId, chatId: context.chatId, sourceFile: source.metadata, sourceDocumentId: input.sourceKind === "chat" ? null : input.documentId, title, parentReportId: input.parentReportId });
          if (reservation) await attachReservationScope(reservation.id, context.userId, reportId);
        } catch (cause) {
          if (reservation) await closeReservation({ reservationId: reservation.id, userId: context.userId, success: false });
          throw cause;
        }
        let profile;
        try {
          profile = await categorizeApplication(source, {
            userId: context.userId,
            reservationId: reservation?.id ?? null,
            feature: "Application categorization",
            operationId: reportId,
          });
        } catch (cause) {
          await failReport(reportId, context.userId, "CATEGORIZATION_FAILED").catch((failure) => {
            console.error("Failed to mark report categorization as failed", failure);
          });
          if (reservation) await closeReservation({ reservationId: reservation.id, userId: context.userId, success: false, scopeId: reportId });
          throw cause;
        }
        return { reportId, profile, privacy: source.metadata.kind === "chat" ? "The report stores structured results; the typed brief remains part of chat history." : "The source PDF is retained in configured S3 storage for this conversation." };
      },
    }),
    runLocalFitPrediction: tool({
      description: "Run the versioned fit model in the user's browser. Always call this after analyzeApplication succeeds.",
      inputSchema: z.object({ reportId: z.string(), profile: generatedApplicationProfileSchema }),
    }),
    publishReport: tool({
      description: "Lock the local model output, research five public comparable companies, and draft the final report. Always call this after runLocalFitPrediction succeeds.",
      inputSchema: z.object({ reportId: z.string(), profile: generatedApplicationProfileSchema, prediction: predictionResultSchema }),
      execute: async ({ reportId, profile, prediction }) => {
        const existing = await getReport(context.userId, reportId);
        if (!existing || existing.chatId !== context.chatId || existing.status !== "processing") throw new Error("REPORT_NOT_PUBLISHABLE");
        if (prediction.modelVersion !== appConfig.modelVersion || prediction.datasetVersion !== appConfig.datasetVersion) throw new Error("MODEL_VERSION_MISMATCH");
        let research;
        try {
          research = await startReportResearch({ reportId, userId: context.userId, profile, prediction, chatText: context.chatText });
        } catch (cause) {
          const reservation = await import("@/lib/billing/repository").then(({ findOpenReservationByScope }) => findOpenReservationByScope(context.userId, reportId));
          if (reservation) await closeReservation({ reservationId: reservation.id, userId: context.userId, success: false, scopeId: reportId });
          throw cause;
        }
        return { ...research, title: `${profile.companyName} · YC Fit Report`, score: prediction.score };
      },
    }),
    searchYcCompanies: tool({
      description: "Semantically search the Turso-backed public YC company directory from 2020 through the current year. Pass the user's natural-language intent in query and add exact filters only when requested. Use this before requesting exact company data or research.",
      inputSchema: companySearchInputSchema,
      execute: async (input) => {
        const [result, manifest] = await Promise.all([
          searchYcCompanies(input, {
            metering: {
              userId: context.userId,
              reservationId: context.reservationId ?? null,
              feature: "Authenticated semantic search",
              operationId: context.requestId,
            },
          }),
          loadYcDatasetManifest(),
        ]);
        return { datasetVersion: manifest.version, ...result };
      },
    }),
    getYcCompanyData: tool({
      description: "Get public YC directory facts and cached live YC profile details for one to ten exact company IDs. This is a factual lookup and does not create a report.",
      inputSchema: z.object({ companyIds: z.array(z.number().int()).min(1).max(10) }),
      execute: async ({ companyIds }) => {
        const [companies, manifest] = await Promise.all([
          getYcCompaniesByIds(companyIds),
          loadYcDatasetManifest(),
        ]);
        const values = await Promise.all(companies.map(async (company) => {
          try {
            return { company, detail: await fetchYcCompanyDetail(company.slug, context.requestSignal), warning: null };
          } catch {
            return { company, detail: null, warning: "Live YC profile details are temporarily unavailable." };
          }
        }));
        return { datasetVersion: manifest.version, companies: values };
      },
    }),
    researchYcCompanies: tool({
      description: "After a company-research confirmation, create a private report record and enqueue durable Firecrawl and public-YC research for one to ten exact company IDs. This returns immediately with a progress-page link; the report page completes the browser map after background research finishes. This tool never accepts or requires a PDF.",
      inputSchema: z.object({
        companyIds: z.array(z.number().int()).min(1).max(10),
        request: z.string().min(1).max(1_000),
      }),
      execute: async ({ companyIds, request }) => {
        const hasApproval = approvedActions.has("company-research");
        chatToolLog(hasApproval ? "info" : "warn", "company_research.authorization", {
          requestId: context.requestId,
          chatId: context.chatId,
          hasApproval,
          approvedActions: [...approvedActions],
          companyIds,
          requestLength: request.length,
        });
        if (!hasApproval) throw new Error("COMPANY_RESEARCH_CONFIRMATION_REQUIRED");
        approvedActions.delete("company-research");
        try {
          const { reportId, runId } = await startCompanyResearchRun({
            userId: context.userId,
            chatId: context.chatId,
            companyIds,
            request,
            requestId: context.requestId,
          });
          chatToolLog("info", "company_research.queued", {
            requestId: context.requestId,
            chatId: context.chatId,
            reportId,
            workflowRunId: runId,
            companyCount: companyIds.length,
          });
          return {
            ok: true as const,
            reportId,
            href: `/company-reports/${reportId}`,
            status: "researching" as const,
            title: companyIds.length === 1 ? "YC company research" : `${companyIds.length} YC companies · Research`,
            companyCount: companyIds.length,
          };
        } catch (runError) {
          const cause = runError instanceof CompanyResearchRunError ? runError.originalCause : runError;
          const stage = runError instanceof CompanyResearchRunError ? runError.stage : "company_lookup";
          const reportId = runError instanceof CompanyResearchRunError ? runError.reportId : undefined;
          chatToolLog("error", "company_research.failed", {
            requestId: context.requestId,
            chatId: context.chatId,
            reportId,
            stage,
            ...summarizeToolError(cause),
          });
          if (context.requestSignal?.aborted || summarizeToolError(cause).errorCode === "ABORTED") throw cause;
          return companyResearchFailureResult(cause, stage, reportId);
        }
      },
    }),
    stop: tool({
      description: "Finish the current response only after all required work is complete. Put the complete user-visible Markdown answer in answer, or use an empty answer when a rich result card already contains the complete response. Call this as the only tool in the final step.",
      inputSchema: stopInputSchema,
      outputSchema: stopInputSchema,
      execute: async (input) => input,
    }),
  };
}

export type AnalysisTools = ReturnType<typeof createAnalysisTools>;
