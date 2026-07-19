import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { appConfig } from "@/config";
import { questionInputSchema, questionOutputSchema } from "@/lib/ai/question";
import { categorizeApplication } from "@/lib/analysis/server";
import { buildReportDocument } from "@/lib/analysis/report";
import { applicationProfileSchema, predictionResultSchema, sourceFileMetadataSchema, type ExtractedPdf } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";
import { assertWithinRateLimit, completeReport, createReport, getReadyChatDocument, getReport } from "@/lib/db/repository";
import { readRetainedDocument } from "@/lib/storage/chat-documents";

const sourceFileSchema = sourceFileMetadataSchema.extend({ kind: z.literal("pdf").optional() });

const analysisSourceSchema = z.union([
  z.object({ sourceKind: z.literal("pdf").optional(), documentId: z.string().uuid(), sourceFile: sourceFileSchema, parentReportId: z.string().nullable().optional() }),
  z.object({ sourceKind: z.literal("chat"), title: z.string().min(1).max(80).optional(), parentReportId: z.string().nullable().optional() }),
]);

export function createAnalysisTools(context: { userId: string; chatId: string; chatText: string | null; hasApprovedConfirmation: boolean }) {
  let hasApprovedConfirmation = context.hasApprovedConfirmation;
  return {
    askQuestion: tool({
      description: "Ask the user a question through a dedicated UI instead of asking in prose. Supports single-select (which always includes a custom free-form answer), multiple-select, and free-form questions.",
      inputSchema: questionInputSchema,
      outputSchema: questionOutputSchema,
    }),
    confirm: tool({
      description: "Ask the user for approval through a dedicated confirmation UI instead of asking in prose. Use whenever an action requires explicit user confirmation.",
      inputSchema: z.object({
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
        if (!hasApprovedConfirmation) throw new Error("ANALYSIS_CONFIRMATION_REQUIRED");
        hasApprovedConfirmation = false;
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
        const reportId = await createReport({ userId: context.userId, chatId: context.chatId, sourceFile: source.metadata, title, parentReportId: input.parentReportId });
        const profile = await categorizeApplication(source);
        return { reportId, profile, privacy: source.metadata.kind === "chat" ? "The report stores structured results; the typed brief remains part of chat history." : "The source PDF is retained in configured S3 storage for this conversation." };
      },
    }),
    runLocalFitPrediction: tool({
      description: "Run the versioned fit model in the user's browser. Always call this after analyzeApplication succeeds.",
      inputSchema: z.object({ reportId: z.string(), profile: applicationProfileSchema }),
    }),
    publishReport: tool({
      description: "Validate the local model output, create the visual report, and persist only structured results. Always call this after runLocalFitPrediction succeeds.",
      inputSchema: z.object({ reportId: z.string(), profile: applicationProfileSchema, prediction: predictionResultSchema }),
      execute: async ({ reportId, profile, prediction }) => {
        const existing = await getReport(context.userId, reportId);
        if (!existing || existing.chatId !== context.chatId || existing.status !== "processing") throw new Error("REPORT_NOT_PUBLISHABLE");
        if (prediction.modelVersion !== appConfig.modelVersion || prediction.datasetVersion !== appConfig.datasetVersion) throw new Error("MODEL_VERSION_MISMATCH");
        const companies = JSON.parse(await readFile(path.join(process.cwd(), "public", "data", "yc-companies.json"), "utf8")) as YcCompany[];
        const document = buildReportDocument(profile, prediction, companies);
        await completeReport({ id: reportId, userId: context.userId, profile, prediction, document });
        return { reportId, href: `/reports/${reportId}`, title: document.title, score: prediction.score };
      },
    }),
  };
}

export type AnalysisTools = ReturnType<typeof createAnalysisTools>;
