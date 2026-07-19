import "server-only";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import type { UIMessage } from "ai";
import { appConfig } from "@/config";
import { DEFAULT_CHAT_TITLE } from "@/lib/chat-title";
import type { ApplicationProfile, PredictionResult, ReportDocument, SourceFileMetadata } from "@/lib/types/analysis";
import { stripEphemeralParts } from "@/lib/privacy";
import { db } from "./index";
import { analysisRuns, chatDocuments, chats, messages, reports } from "./schema";

export async function createChat(userId: string, title = DEFAULT_CHAT_TITLE) {
  const id = crypto.randomUUID(); const now = new Date();
  await db.insert(chats).values({ id, userId, title, createdAt: now, updatedAt: now });
  return id;
}

export async function listChats(userId: string) {
  return db.select().from(chats).where(eq(chats.userId, userId)).orderBy(desc(chats.updatedAt));
}

export async function getChat(userId: string, id: string): Promise<typeof chats.$inferSelect | null> {
  return (await db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, userId))).limit(1))[0] ?? null;
}

export async function renameChat(userId: string, id: string, title: string) {
  const updated = await db.update(chats)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
    .returning({ id: chats.id, title: chats.title });
  return updated[0] ?? null;
}

export async function deleteChat(userId: string, id: string): Promise<{ id: string } | null> {
  const deleted = await db.delete(chats)
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
    .returning({ id: chats.id });
  return deleted[0] ?? null;
}

export async function renameChatIfTitleMatches(userId: string, id: string, currentTitle: string, title: string) {
  const updated = await db.update(chats)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(chats.id, id), eq(chats.userId, userId), eq(chats.title, currentTitle)))
    .returning({ id: chats.id, title: chats.title });
  return updated[0] ?? null;
}

export async function loadMessages(userId: string, chatId: string): Promise<UIMessage[]> {
  const rows = await db.select().from(messages).where(and(eq(messages.chatId, chatId), eq(messages.userId, userId))).orderBy(asc(messages.sequence));
  return rows.map((row) => ({ id: row.id, role: row.role as UIMessage["role"], parts: row.parts as UIMessage["parts"], metadata: row.metadata ?? undefined }));
}

export async function replaceMessages(userId: string, chatId: string, values: UIMessage[]) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(messages).where(and(eq(messages.chatId, chatId), eq(messages.userId, userId)));
    if (values.length) await tx.insert(messages).values(values.map((message, sequence) => ({ id: message.id, chatId, userId, role: message.role as "system" | "user" | "assistant", parts: stripEphemeralParts(message.parts) as unknown[], metadata: (message.metadata ?? null) as Record<string, unknown> | null, sequence, createdAt: now })));
    await tx.update(chats).set({ updatedAt: now }).where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
  });
}

export async function createChatDocument(input: { id: string; userId: string; chatId: string; metadata: SourceFileMetadata; objectKey: string; extractedObjectKey: string }) {
  await db.insert(chatDocuments).values({
    ...input,
    status: "uploading",
    createdAt: new Date(),
  });
  return input.id;
}

export async function getChatDocument(userId: string, chatId: string, id: string): Promise<typeof chatDocuments.$inferSelect | null> {
  return (await db.select().from(chatDocuments).where(and(eq(chatDocuments.id, id), eq(chatDocuments.userId, userId), eq(chatDocuments.chatId, chatId))).limit(1))[0] ?? null;
}

export async function getReadyChatDocument(userId: string, chatId: string, id: string): Promise<typeof chatDocuments.$inferSelect | null> {
  return (await db.select().from(chatDocuments).where(and(eq(chatDocuments.id, id), eq(chatDocuments.userId, userId), eq(chatDocuments.chatId, chatId), eq(chatDocuments.status, "ready"))).limit(1))[0] ?? null;
}

export async function listReadyChatDocumentIds(userId: string, chatId: string) {
  return db.select({ id: chatDocuments.id }).from(chatDocuments).where(and(eq(chatDocuments.userId, userId), eq(chatDocuments.chatId, chatId), eq(chatDocuments.status, "ready")));
}

export async function markChatDocumentReady(userId: string, chatId: string, id: string) {
  const updated = await db.update(chatDocuments)
    .set({ status: "ready", readyAt: new Date() })
    .where(and(eq(chatDocuments.id, id), eq(chatDocuments.userId, userId), eq(chatDocuments.chatId, chatId), eq(chatDocuments.status, "uploading")))
    .returning({ id: chatDocuments.id });
  return updated[0] ?? null;
}

export async function deleteChatDocumentRecord(userId: string, chatId: string, id: string) {
  const deleted = await db.delete(chatDocuments)
    .where(and(eq(chatDocuments.id, id), eq(chatDocuments.userId, userId), eq(chatDocuments.chatId, chatId)))
    .returning({ id: chatDocuments.id });
  return deleted[0] ?? null;
}

export async function listChatDocumentObjectKeys(userId: string, chatId: string) {
  return db.select({ objectKey: chatDocuments.objectKey, extractedObjectKey: chatDocuments.extractedObjectKey })
    .from(chatDocuments)
    .where(and(eq(chatDocuments.userId, userId), eq(chatDocuments.chatId, chatId)));
}

export async function createReport(input: { userId: string; chatId: string; sourceFile: SourceFileMetadata; title: string; parentReportId?: string | null }) {
  const id = crypto.randomUUID(); const now = new Date();
  await db.insert(reports).values({ id, userId: input.userId, chatId: input.chatId, parentReportId: input.parentReportId ?? null, status: "processing", title: input.title, sourceFile: input.sourceFile, profile: null, prediction: null, document: null, modelVersion: appConfig.modelVersion, datasetVersion: appConfig.datasetVersion, createdAt: now, updatedAt: now });
  await db.insert(analysisRuns).values({ id: crypto.randomUUID(), userId: input.userId, chatId: input.chatId, reportId: id, stage: "approved", createdAt: now, updatedAt: now });
  return id;
}

export async function completeReport(input: { id: string; userId: string; profile: ApplicationProfile; prediction: PredictionResult; document: ReportDocument }) {
  await db.update(reports).set({ status: "complete", profile: input.profile, prediction: input.prediction, document: input.document, updatedAt: new Date() }).where(and(eq(reports.id, input.id), eq(reports.userId, input.userId)));
}

export async function failReport(id: string, userId: string, failureCode: string) {
  await db.update(reports).set({ status: "failed", failureCode, updatedAt: new Date() }).where(and(eq(reports.id, id), eq(reports.userId, userId)));
}

export async function listReports(userId: string) {
  return db.select().from(reports).where(eq(reports.userId, userId)).orderBy(desc(reports.createdAt));
}

export async function getReport(userId: string, id: string) {
  return (await db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, userId))).limit(1))[0] ?? null;
}

export async function assertWithinRateLimit(userId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.select({ id: analysisRuns.id }).from(analysisRuns).where(and(eq(analysisRuns.userId, userId), gte(analysisRuns.createdAt, since)));
  if (recent.length >= appConfig.analysisRateLimitPerHour) throw new Error("ANALYSIS_RATE_LIMIT");
}
