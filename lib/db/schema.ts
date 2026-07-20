import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ReportDocument, ApplicationProfile, PredictionResult, SourceFileMetadata } from "@/lib/types/analysis";
import type { CompanyClusterMap, CompanyResearchDraft, CompanyResearchMapInput, CompanyResearchReportDocument } from "@/lib/types/company-research";
import type { DatasetManifest } from "@/lib/types/company";
import { f32Vector, YC_EMBEDDING_DIMENSIONS } from "@/lib/yc/embedding";

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

export const ycCompanies = sqliteTable("yc_companies", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  website: text("website"),
  batch: text("batch").notNull(),
  year: integer("year").notNull(),
  industry: text("industry").notNull(),
  subindustry: text("subindustry").notNull(),
  oneLiner: text("one_liner").notNull(),
  longDescription: text("long_description").notNull(),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
  location: text("location").notNull(),
  operatingArea: text("operating_area").notNull(),
  targetMarket: text("target_market").notNull(),
  aiLinked: integer("ai_linked", { mode: "boolean" }).notNull(),
  hiring: integer("hiring", { mode: "boolean" }).notNull(),
  logo: text("logo"),
  x: real("x").notNull(),
  y: real("y").notNull(),
  searchText: text("search_text").notNull(),
  sourceHash: text("source_hash").notNull(),
  embeddingModel: text("embedding_model").notNull(),
  embedding: f32Vector("embedding", { dimensions: YC_EMBEDDING_DIMENSIONS }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("yc_companies_slug_idx").on(table.slug),
  index("yc_companies_year_idx").on(table.year),
  index("yc_companies_batch_idx").on(table.batch),
  index("yc_companies_industry_idx").on(table.industry),
  index("yc_companies_target_market_idx").on(table.targetMarket),
  index("yc_companies_operating_area_idx").on(table.operatingArea),
  index("yc_companies_ai_linked_idx").on(table.aiLinked),
  index("yc_companies_hiring_idx").on(table.hiring),
  index("yc_companies_embedding_model_idx").on(table.embeddingModel),
  check("yc_companies_embedding_shape_check", sql`typeof(${table.embedding}) = 'blob' AND length(${table.embedding}) = 6144`),
]);

export type YcDatasetManifestRow = DatasetManifest & {
  embeddingModel: string;
  embeddingDimensions: number;
};

export const ycDatasetManifest = sqliteTable("yc_dataset_manifest", {
  id: integer("id").primaryKey(),
  version: text("version").notNull(),
  source: text("source").notNull(),
  generatedAt: text("generated_at").notNull(),
  firstYear: integer("first_year").notNull(),
  lastYear: integer("last_year").notNull(),
  companyCount: integer("company_count").notNull(),
  batches: text("batches", { mode: "json" }).$type<string[]>().notNull(),
  industries: text("industries", { mode: "json" }).$type<string[]>().notNull(),
  embeddingModel: text("embedding_model").notNull(),
  embeddingDimensions: integer("embedding_dimensions").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const ycSemanticSearchRateLimits = sqliteTable("yc_semantic_search_rate_limits", {
  clientKey: text("client_key").primaryKey(),
  windowStartedAt: integer("window_started_at", { mode: "timestamp_ms" }).notNull(),
  requestCount: integer("request_count").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("yc_semantic_search_rate_limits_updated_idx").on(table.updatedAt)]);

export type AiUsageSnapshot = {
  inputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokens?: number;
  outputTokenDetails?: {
    textTokens?: number;
    reasoningTokens?: number;
  };
  totalTokens?: number;
};

export const billingAccounts = sqliteTable("billing_accounts", {
  userId: text("user_id").primaryKey(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  balancePoints: integer("balance_points").notNull().default(0),
  reservedPoints: integer("reserved_points").notNull().default(0),
  costRemainderNanoUsd: integer("cost_remainder_nano_usd").notNull().default(0),
  promotionalGrantAt: integer("promotional_grant_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  check("billing_accounts_reserved_nonnegative", sql`${table.reservedPoints} >= 0`),
  check("billing_accounts_remainder_nonnegative", sql`${table.costRemainderNanoUsd} >= 0`),
]);

export const creditReservations = sqliteTable("credit_reservations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  operationKey: text("operation_key").notNull().unique(),
  feature: text("feature").notNull(),
  scopeId: text("scope_id"),
  reservedPoints: integer("reserved_points").notNull(),
  settledPoints: integer("settled_points").notNull().default(0),
  reportFeePoints: integer("report_fee_points").notNull().default(0),
  status: text("status", { enum: ["open", "settled", "released", "needs_review"] }).notNull(),
  closeRequestedSuccess: integer("close_requested_success", { mode: "boolean" }),
  closeRequestedReportFee: integer("close_requested_report_fee", { mode: "boolean" }).notNull().default(false),
  closeRequestedAt: integer("close_requested_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("credit_reservations_user_status_idx").on(table.userId, table.status),
  index("credit_reservations_scope_idx").on(table.scopeId),
  check("credit_reservations_amount_nonnegative", sql`${table.reservedPoints} >= 0 AND ${table.settledPoints} >= 0 AND ${table.reportFeePoints} >= 0`),
]);

export const pointsLedger = sqliteTable("points_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind", { enum: ["promotional_grant", "top_up", "provider_usage", "report_fee", "refund", "dispute", "dispute_reversal", "adjustment"] }).notNull(),
  pointsDelta: integer("points_delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  description: text("description").notNull(),
  referenceId: text("reference_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [index("points_ledger_user_created_idx").on(table.userId, table.createdAt)]);

export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  reservationId: text("reservation_id"),
  fundingScope: text("funding_scope", { enum: ["user", "platform"] }).notNull(),
  provider: text("provider").notNull(),
  feature: text("feature").notNull(),
  model: text("model"),
  externalId: text("external_id"),
  usage: text("usage", { mode: "json" }).$type<AiUsageSnapshot | null>(),
  providerCredits: integer("provider_credits"),
  costNanoUsd: integer("cost_nano_usd").notNull(),
  chargedPoints: integer("charged_points").notNull().default(0),
  status: text("status", { enum: ["pending", "settled", "needs_review"] }).notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  settledAt: integer("settled_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("usage_events_user_created_idx").on(table.userId, table.createdAt),
  index("usage_events_external_idx").on(table.provider, table.externalId),
]);

export const billingTopups = sqliteTable("billing_topups", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  packId: text("pack_id").notNull(),
  points: integer("points").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: text("status", { enum: ["pending", "paid", "failed", "refunded", "disputed"] }).notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  stripeInvoiceId: text("stripe_invoice_id").unique(),
  hostedInvoiceUrl: text("hosted_invoice_url"),
  invoicePdfUrl: text("invoice_pdf_url"),
  refundedAmountCents: integer("refunded_amount_cents").notNull().default(0),
  reversedPoints: integer("reversed_points").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  paidAt: integer("paid_at", { mode: "timestamp_ms" }),
}, (table) => [index("billing_topups_user_created_idx").on(table.userId, table.createdAt)]);

export const stripeWebhookEvents = sqliteTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status", { enum: ["processing", "processed", "ignored", "failed"] }).notNull(),
  objectId: text("object_id"),
  failureCode: text("failure_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
});
