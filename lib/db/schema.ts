import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ReportDocument, ApplicationProfile, PredictionResult, SourceFileMetadata } from "@/lib/types/analysis";
import type { CompanyClusterMap, CompanyResearchDraft, CompanyResearchMapInput, CompanyResearchReportDocument } from "@/lib/types/company-research";

export const chats = sqliteTable("chats", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("chats_user_updated_idx").on(table.userId, table.updatedAt)]);

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
  parts: text("parts", { mode: "json" }).$type<unknown[]>().notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown> | null>(),
  sequence: integer("sequence").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("messages_chat_sequence_idx").on(table.chatId, table.sequence)]);

export const chatDocuments = sqliteTable("chat_documents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  metadata: text("metadata", { mode: "json" }).$type<SourceFileMetadata>().notNull(),
  objectKey: text("object_key").notNull().unique(),
  extractedObjectKey: text("extracted_object_key").notNull().unique(),
  status: text("status", { enum: ["uploading", "ready"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  readyAt: integer("ready_at", { mode: "timestamp_ms" }),
}, (table) => [index("chat_documents_chat_status_idx").on(table.chatId, table.status)]);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  parentReportId: text("parent_report_id"),
  status: text("status", { enum: ["processing", "researching", "drafting", "complete", "failed"] }).notNull(),
  title: text("title").notNull(),
  sourceFile: text("source_file", { mode: "json" }).$type<SourceFileMetadata>().notNull(),
  sourceDocumentId: text("source_document_id"),
  profile: text("profile", { mode: "json" }).$type<ApplicationProfile | null>(),
  prediction: text("prediction", { mode: "json" }).$type<PredictionResult | null>(),
  document: text("document", { mode: "json" }).$type<ReportDocument | null>(),
  modelVersion: text("model_version").notNull(),
  datasetVersion: text("dataset_version").notNull(),
  reportModel: text("report_model"),
  researchDeadlineAt: integer("research_deadline_at", { mode: "timestamp_ms" }),
  failureCode: text("failure_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("reports_user_created_idx").on(table.userId, table.createdAt),
  index("reports_chat_created_idx").on(table.chatId, table.createdAt),
]);

export type ReportResearchTarget = {
  companyId: number;
  url: string;
  sourceType: "yc-profile" | "company-website" | "founder-source" | "related-coverage";
};

export const reportResearchJobs = sqliteTable("report_research_jobs", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["crawl", "batch-scrape"] }).notNull(),
  comparableCompanyId: integer("comparable_company_id"),
  firecrawlJobId: text("firecrawl_job_id").notNull().unique(),
  status: text("status", { enum: ["running", "complete", "failed"] }).notNull(),
  targets: text("targets", { mode: "json" }).$type<ReportResearchTarget[]>().notNull(),
  creditsUsed: integer("credits_used").notNull().default(0),
  failureCode: text("failure_code"),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("report_research_jobs_report_idx").on(table.reportId),
  index("report_research_jobs_firecrawl_idx").on(table.firecrawlJobId),
]);

export const companyResearchReports = sqliteTable("company_research_reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["researching", "mapping", "complete", "failed"] }).notNull(),
  title: text("title").notNull(),
  request: text("request").notNull(),
  companyIds: text("company_ids", { mode: "json" }).$type<number[]>().notNull(),
  document: text("document", { mode: "json" }).$type<CompanyResearchDraft | CompanyResearchReportDocument | null>(),
  mapInput: text("map_input", { mode: "json" }).$type<CompanyResearchMapInput | null>(),
  map: text("map", { mode: "json" }).$type<CompanyClusterMap | null>(),
  modelVersion: text("model_version").notNull(),
  datasetVersion: text("dataset_version").notNull(),
  failureCode: text("failure_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("company_research_reports_user_created_idx").on(table.userId, table.createdAt),
  index("company_research_reports_chat_created_idx").on(table.chatId, table.createdAt),
]);

export const analysisRuns = sqliteTable("analysis_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  chatId: text("chat_id").notNull().references(() => chats.id, { onDelete: "cascade" }),
  reportId: text("report_id").references(() => reports.id, { onDelete: "set null" }),
  toolCallId: text("tool_call_id"),
  stage: text("stage", { enum: ["approved", "categorizing", "predicting", "publishing", "complete", "failed"] }).notNull(),
  failureCode: text("failure_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("analysis_runs_user_created_idx").on(table.userId, table.createdAt)]);
