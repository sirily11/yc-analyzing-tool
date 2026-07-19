import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ReportDocument, ApplicationProfile, PredictionResult, SourceFileMetadata } from "@/lib/types/analysis";

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
  status: text("status", { enum: ["processing", "complete", "failed"] }).notNull(),
  title: text("title").notNull(),
  sourceFile: text("source_file", { mode: "json" }).$type<SourceFileMetadata>().notNull(),
  profile: text("profile", { mode: "json" }).$type<ApplicationProfile | null>(),
  prediction: text("prediction", { mode: "json" }).$type<PredictionResult | null>(),
  document: text("document", { mode: "json" }).$type<ReportDocument | null>(),
  modelVersion: text("model_version").notNull(),
  datasetVersion: text("dataset_version").notNull(),
  failureCode: text("failure_code"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("reports_user_created_idx").on(table.userId, table.createdAt),
  index("reports_chat_created_idx").on(table.chatId, table.createdAt),
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
