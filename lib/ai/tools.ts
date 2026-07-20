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
import { assertWithinRateLimit, completeCompanyResearchReport, createCompanyResearchReport, createReport, failCompanyResearchReport, failReport, getCompanyResearchReport, getReadyChatDocument, getReport, storeCompanyResearchDraft } from "@/lib/db/repository";
import { readRetainedDocument } from "@/lib/storage/chat-documents";
import { companySearchInputSchema, filterYcCompanies, getYcCompaniesByIds, loadYcCompanies } from "@/lib/yc/companies";
import { fetchYcCompanyDetail } from "@/lib/yc/company-data";
import type { ConfirmationAction } from "@/lib/ai/chat-source";
import { startReportResearch } from "@/lib/research/report-research";

const sourceFileSchema = sourceFileMetadataSchema.extend({ kind: z.literal("pdf").optional() });

const analysisSourceSchema = z.union([
  z.object({ sourceKind: z.literal("pdf").optional(), documentId: z.string().uuid(), sourceFile: sourceFileSchema, parentReportId: z.string().nullable().optional() }),
  z.object({ sourceKind: z.literal("chat"), title: z.string().min(1).max(80).optional(), parentReportId: z.string().nullable().optional() }),
]);

export function createAnalysisTools(context: { userId: string; chatId: string; chatText: string | null; approvedActions: ReadonlySet<ConfirmationAction>; requestSignal?: AbortSignal }) {
  const approvedActions = new Set(context.approvedActions);
  return {
    askQuestion: tool({
      description: "Ask the user a question through a dedicated UI instead of asking in prose. Supports single-select (which always includes a custom free-form answer), multiple-select, and free-form questions.",
      inputSchema: questionInputSchema,
      outputSchema: questionOutputSchema,
    }),
    confirm: tool({
      description: "Ask the user for approval through a dedicated confirmation UI instead of asking in prose. Use whenever an action requires explicit user confirmation.",
      inputSchema: z.object({
        action: z.enum(["application-analysis", "company-research"]).default("application-analysis"),
        title: z.string().min(1).max(80),
        message: z.string().min(1).max(240),
        confirmLabel: z.string().min(1).max(40).optional(),
        cancelLabel: z.string().min(1).max(40).optional(),
      }),
      needsApproval: true,
      execute: async () => ({ confirmed: true }),
    }),
    analyzeApplication: tool({
      description: "Categorize the confirmed source into the fixed Application Signal schema. Never call this before confirm returns confirmed.",
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

        await assertWithinRateLimit(context.userId);
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
      description: "After a company-research confirmation, use Firecrawl and public YC sources to create a cited research draft for one to ten exact YC company IDs. Then call runCompanyClusterMap with the exact returned reportId.",
      inputSchema: z.object({
        companyIds: z.array(z.number().int()).min(1).max(10),
        request: z.string().min(1).max(1_000),
      }),
      execute: async ({ companyIds, request }) => {
        if (!approvedActions.has("company-research")) throw new Error("COMPANY_RESEARCH_CONFIRMATION_REQUIRED");
        approvedActions.delete("company-research");
        await assertWithinRateLimit(context.userId);
        const uniqueIds = [...new Set(companyIds)];
        const companies = await getYcCompaniesByIds(uniqueIds);
        const reportId = await createCompanyResearchReport({ userId: context.userId, chatId: context.chatId, request, companyIds: uniqueIds });
        try {
          const draft = await buildCompanyResearchDraft({ companies, request, signal: context.requestSignal });
          const officialCompanyIds = new Set(draft.sources.filter((source) => source.kind === "official-site" && source.status === "ok").map((source) => source.companyId));
          const mapInput = companyResearchMapInputSchema.parse({
            reportId,
            targets: draft.companies.map((company) => ({ companyId: company.companyId, semanticText: company.semanticText, textSource: officialCompanyIds.has(company.companyId) ? "firecrawl" : "dataset" })),
          });
          if (!await storeCompanyResearchDraft({ id: reportId, userId: context.userId, draft, mapInput })) throw new Error("COMPANY_RESEARCH_NOT_STORABLE");
          return { reportId, title: draft.title, executiveSummary: draft.executiveSummary, companies: draft.companies, comparison: draft.comparison, sources: draft.sources, warnings: draft.warnings };
        } catch (cause) {
          await failCompanyResearchReport(reportId, context.userId, cause instanceof Error ? cause.message.slice(0, 120) : "COMPANY_RESEARCH_FAILED");
          throw cause;
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
  };
}

export type AnalysisTools = ReturnType<typeof createAnalysisTools>;
