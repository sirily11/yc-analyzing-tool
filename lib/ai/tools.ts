import "server-only";
import { createHash } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import { appConfig } from "@/config";
import { questionInputSchema, questionOutputSchema } from "@/lib/ai/question";
import { categorizeApplication } from "@/lib/analysis/server";
import { buildCompanyResearchDraft } from "@/lib/analysis/company-research";
import { generatedApplicationProfileSchema, predictionResultSchema, sourceFileMetadataSchema, type ExtractedPdf } from "@/lib/types/analysis";
import { companyClusterMapSchema, companyResearchDraftSchema, companyResearchMapInputSchema, companyResearchReportDocumentSchema } from "@/lib/types/company-research";
import { completeCompanyResearchReport, createCompanyResearchReport, createReport, failCompanyResearchReport, failReport, getCompanyResearchReport, getReadyChatDocument, getReport, storeCompanyResearchDraft } from "@/lib/db/repository";
import { FirecrawlScrapeError } from "@/lib/firecrawl/client";
import { readRetainedDocument } from "@/lib/storage/chat-documents";
import { companySearchInputSchema, filterYcCompanies, getYcCompaniesByIds, loadYcCompanies } from "@/lib/yc/companies";
import { fetchYcCompanyDetail } from "@/lib/yc/company-data";
import { confirmationInputSchema, stopInputSchema, type ConfirmationAction } from "@/lib/ai/chat-source";
import { chatToolLog, summarizeToolError } from "@/lib/ai/tool-log";
import { startReportResearch } from "@/lib/research/report-research";

const sourceFileSchema = sourceFileMetadataSchema.extend({ kind: z.literal("pdf").optional() });

const analysisSourceSchema = z.union([
  z.object({ sourceKind: z.literal("pdf").optional(), documentId: z.string().uuid(), sourceFile: sourceFileSchema, parentReportId: z.string().nullable().optional() }),
  z.object({ sourceKind: z.literal("chat"), title: z.string().min(1).max(80).optional(), parentReportId: z.string().nullable().optional() }),
]);

function companyResearchFailureResult(cause: unknown, stage: string, reportId: string | undefined) {
  const summary = summarizeToolError(cause);
  const scrapeErrors = cause instanceof FirecrawlScrapeError ? cause.failures.slice(0, 20) : [];
  const status = summary.errorCode.match(/:(\d{3})$/)?.[1];
  const message = scrapeErrors.length > 0
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
    },
  };
}

export function createAnalysisTools(context: { userId: string; chatId: string; chatText: string | null; approvedActions: ReadonlySet<ConfirmationAction>; requestId: string; requestSignal?: AbortSignal }) {
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

        const title = `${source.metadata.name.replace(/\.pdf$/i, "")} · Analysis`;
        const reportId = await createReport({ userId: context.userId, chatId: context.chatId, sourceFile: source.metadata, sourceDocumentId: input.sourceKind === "chat" ? null : input.documentId, title, parentReportId: input.parentReportId });
        let profile;
        try {
          profile = await categorizeApplication(source);
        } catch (cause) {
          await failReport(reportId, context.userId, "CATEGORIZATION_FAILED").catch((failure) => {
            console.error("Failed to mark report categorization as failed", failure);
          });
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
        const research = await startReportResearch({ reportId, userId: context.userId, profile, prediction, chatText: context.chatText });
        return { ...research, title: `${profile.companyName} · YC Fit Report`, score: prediction.score };
      },
    }),
    searchYcCompanies: tool({
      description: "Search the versioned 2022–2026 public YC company dataset. Use this to resolve names or find companies by topic and filters before requesting exact company data or research.",
      inputSchema: companySearchInputSchema,
      execute: async (input) => {
        const result = filterYcCompanies(await loadYcCompanies(), input);
        return { datasetVersion: appConfig.datasetVersion, ...result };
      },
    }),
    getYcCompanyData: tool({
      description: "Get public YC directory facts and cached live YC profile details for one to ten exact company IDs. This is a factual lookup and does not create a report.",
      inputSchema: z.object({ companyIds: z.array(z.number().int()).min(1).max(10) }),
      execute: async ({ companyIds }) => {
        const companies = await getYcCompaniesByIds(companyIds);
        const values = await Promise.all(companies.map(async (company) => {
          try {
            return { company, detail: await fetchYcCompanyDetail(company.slug, context.requestSignal), warning: null };
          } catch {
            return { company, detail: null, warning: "Live YC profile details are temporarily unavailable." };
          }
        }));
        return { datasetVersion: appConfig.datasetVersion, companies: values };
      },
    }),
    researchYcCompanies: tool({
      description: "After a company-research confirmation, use Firecrawl and public YC sources to create a cited research draft for one to ten exact YC company IDs. This tool never accepts or requires a PDF. If it returns ok false, report its error and scrapeErrors to the user without retrying or calling another research tool. If it returns ok true, call runCompanyClusterMap with the exact returned reportId.",
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
        let stage = "company_lookup";
        let reportId: string | undefined;
        try {
          const uniqueIds = [...new Set(companyIds)];
          const companies = await getYcCompaniesByIds(uniqueIds);
          stage = "report_create";
          reportId = await createCompanyResearchReport({ userId: context.userId, chatId: context.chatId, request, companyIds: uniqueIds });
          stage = "public_research";
          const draft = await buildCompanyResearchDraft({ companies, request, requestId: context.requestId, chatId: context.chatId, signal: context.requestSignal });
          const officialCompanyIds = new Set(draft.sources.filter((source) => source.kind === "official-site" && source.status === "ok").map((source) => source.companyId));
          stage = "map_prepare";
          const mapInput = companyResearchMapInputSchema.parse({
            reportId,
            targets: draft.companies.map((company) => ({ companyId: company.companyId, semanticText: company.semanticText, textSource: officialCompanyIds.has(company.companyId) ? "firecrawl" : "dataset" })),
          });
          stage = "draft_store";
          if (!await storeCompanyResearchDraft({ id: reportId, userId: context.userId, draft, mapInput })) throw new Error("COMPANY_RESEARCH_NOT_STORABLE");
          chatToolLog("info", "company_research.completed", {
            requestId: context.requestId,
            chatId: context.chatId,
            reportId,
            companyCount: draft.companies.length,
            sourceCount: draft.sources.length,
            warningCount: draft.warnings.length,
          });
          return { ok: true as const, reportId, title: draft.title, executiveSummary: draft.executiveSummary, companies: draft.companies, comparison: draft.comparison, sources: draft.sources, warnings: draft.warnings };
        } catch (cause) {
          chatToolLog("error", "company_research.failed", {
            requestId: context.requestId,
            chatId: context.chatId,
            reportId,
            stage,
            ...summarizeToolError(cause),
          });
          if (reportId) await failCompanyResearchReport(reportId, context.userId, cause instanceof Error ? cause.message.slice(0, 120) : "COMPANY_RESEARCH_FAILED");
          if (context.requestSignal?.aborted || summarizeToolError(cause).errorCode === "ABORTED") throw cause;
          return companyResearchFailureResult(cause, stage, reportId);
        }
      },
    }),
    runCompanyClusterMap: tool({
      description: "Run the versioned 70/30 hybrid semantic cluster map in the user's browser. Call this with the exact reportId returned by researchYcCompanies.",
      inputSchema: z.object({ reportId: z.string().uuid() }),
      outputSchema: companyClusterMapSchema,
    }),
    publishCompanyResearchReport: tool({
      description: "Validate and persist a company research report after runCompanyClusterMap. Use the exact reportId and map output from the prior tools.",
      inputSchema: z.object({ reportId: z.string().uuid(), map: companyClusterMapSchema }),
      execute: async ({ reportId, map }) => {
        const existing = await getCompanyResearchReport(context.userId, reportId);
        if (!existing || existing.chatId !== context.chatId || existing.status !== "mapping" || !existing.document) throw new Error("COMPANY_REPORT_NOT_PUBLISHABLE");
        if (map.modelVersion !== appConfig.modelVersion || map.datasetVersion !== appConfig.datasetVersion) throw new Error("MODEL_VERSION_MISMATCH");
        const targetIds = new Set(existing.companyIds);
        const mappedTargets = new Set(map.points.filter((point) => point.target).map((point) => point.companyId));
        if (targetIds.size !== mappedTargets.size || [...targetIds].some((id) => !mappedTargets.has(id))) throw new Error("COMPANY_MAP_TARGET_MISMATCH");
        const draft = companyResearchDraftSchema.parse(existing.document);
        const document = companyResearchReportDocumentSchema.parse({ ...draft, map });
        if (!await completeCompanyResearchReport({ id: reportId, userId: context.userId, map, document })) throw new Error("COMPANY_REPORT_NOT_PUBLISHABLE");
        return { reportId, href: `/company-reports/${reportId}`, title: document.title, companyCount: document.companies.length, executiveSummary: document.executiveSummary };
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
