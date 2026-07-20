import "server-only";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { UIMessage } from "ai";
import { appConfig } from "@/config";
import { DEFAULT_CHAT_TITLE } from "@/lib/chat-title";
import type { ApplicationProfile, PredictionResult, ReportDocument, SourceFileMetadata } from "@/lib/types/analysis";
import type { CompanyClusterMap, CompanyResearchDraft, CompanyResearchMapInput, CompanyResearchReportDocument } from "@/lib/types/company-research";
import { stripEphemeralParts } from "@/lib/privacy";
import { db } from "./index";
import { analysisRuns, chatDocuments, chats, companyResearchReports, messages, reportResearchJobs, reports, type ReportResearchTarget } from "./schema";

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

export async function createReport(input: { userId: string; chatId: string; sourceFile: SourceFileMetadata; sourceDocumentId?: string | null; title: string; parentReportId?: string | null }) {
  const id = crypto.randomUUID(); const now = new Date();
  await db.insert(reports).values({ id, userId: input.userId, chatId: input.chatId, parentReportId: input.parentReportId ?? null, status: "processing", title: input.title, sourceFile: input.sourceFile, sourceDocumentId: input.sourceDocumentId ?? null, profile: null, prediction: null, document: null, modelVersion: appConfig.modelVersion, datasetVersion: appConfig.datasetVersion, createdAt: now, updatedAt: now });
  await db.insert(analysisRuns).values({ id: crypto.randomUUID(), userId: input.userId, chatId: input.chatId, reportId: id, stage: "approved", createdAt: now, updatedAt: now });
  return id;
}

export async function completeReport(input: { id: string; userId: string; profile: ApplicationProfile; prediction: PredictionResult; document: ReportDocument }) {
  await db.update(reports).set({ status: "complete", profile: input.profile, prediction: input.prediction, document: input.document, failureCode: null, updatedAt: new Date() }).where(and(eq(reports.id, input.id), eq(reports.userId, input.userId)));
}

export async function beginReportResearch(input: { id: string; userId: string; profile: ApplicationProfile; prediction: PredictionResult }) {
  const now = new Date();
  const updated = await db.update(reports).set({
    status: "researching",
    profile: input.profile,
    prediction: input.prediction,
    reportModel: appConfig.reportModel,
    researchDeadlineAt: new Date(now.getTime() + appConfig.reportResearch.deadlineMs),
    failureCode: null,
    updatedAt: now,
  }).where(and(eq(reports.id, input.id), eq(reports.userId, input.userId), eq(reports.status, "processing"))).returning({ id: reports.id });
  return updated[0] ?? null;
}

export async function addReportResearchJobs(values: Array<{
  reportId: string;
  kind: "crawl" | "batch-scrape";
  comparableCompanyId?: number | null;
  firecrawlJobId: string;
  targets: ReportResearchTarget[];
}>) {
  if (!values.length) return;
  const now = new Date();
  await db.insert(reportResearchJobs).values(values.map((value) => ({
    id: crypto.randomUUID(),
    reportId: value.reportId,
    kind: value.kind,
    comparableCompanyId: value.comparableCompanyId ?? null,
    firecrawlJobId: value.firecrawlJobId,
    status: "running" as const,
    targets: value.targets,
    createdAt: now,
    updatedAt: now,
  })));
}

export async function listReportResearchJobs(reportId: string) {
  return db.select().from(reportResearchJobs).where(eq(reportResearchJobs.reportId, reportId));
}

export async function getReportResearchJobByExternalId(firecrawlJobId: string) {
  return (await db.select().from(reportResearchJobs).where(eq(reportResearchJobs.firecrawlJobId, firecrawlJobId)).limit(1))[0] ?? null;
}

export async function markReportResearchJob(input: { firecrawlJobId: string; status: "complete" | "failed"; creditsUsed?: number; failureCode?: string | null }) {
  const updated = await db.update(reportResearchJobs).set({
    status: input.status,
    creditsUsed: Math.max(0, Math.floor(input.creditsUsed ?? 0)),
    failureCode: input.failureCode ?? null,
    lastCheckedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(reportResearchJobs.firecrawlJobId, input.firecrawlJobId)).returning();
  return updated[0] ?? null;
}

export async function touchReportResearchJob(firecrawlJobId: string) {
  await db.update(reportResearchJobs).set({ lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(reportResearchJobs.firecrawlJobId, firecrawlJobId));
}

export async function getReportById(id: string) {
  return (await db.select().from(reports).where(eq(reports.id, id)).limit(1))[0] ?? null;
}

export async function claimReportDrafting(id: string) {
  const updated = await db.update(reports).set({ status: "drafting", updatedAt: new Date() })
    .where(and(eq(reports.id, id), eq(reports.status, "researching")))
    .returning();
  return updated[0] ?? null;
}

export async function reclaimStaleReportDrafting(id: string, staleBefore: Date) {
  const updated = await db.update(reports).set({ updatedAt: new Date() })
    .where(and(eq(reports.id, id), eq(reports.status, "drafting"), lte(reports.updatedAt, staleBefore)))
    .returning();
  return updated[0] ?? null;
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

export async function createCompanyResearchReport(input: { userId: string; chatId: string; request: string; companyIds: number[] }) {
  const id = crypto.randomUUID(); const now = new Date();
  await db.insert(companyResearchReports).values({
    id,
    userId: input.userId,
    chatId: input.chatId,
    status: "researching",
    title: input.companyIds.length === 1 ? "YC company research" : `${input.companyIds.length} YC companies · Research`,
    request: input.request,
    companyIds: input.companyIds,
    document: null,
    mapInput: null,
    map: null,
    modelVersion: appConfig.modelVersion,
    datasetVersion: appConfig.datasetVersion,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function storeCompanyResearchDraft(input: { id: string; userId: string; draft: CompanyResearchDraft; mapInput: CompanyResearchMapInput }) {
  const updated = await db.update(companyResearchReports).set({
    status: "mapping",
    title: input.draft.title,
    document: input.draft,
    mapInput: input.mapInput,
    updatedAt: new Date(),
  }).where(and(eq(companyResearchReports.id, input.id), eq(companyResearchReports.userId, input.userId), eq(companyResearchReports.status, "researching"))).returning({ id: companyResearchReports.id });
  return updated[0] ?? null;
}

export async function completeCompanyResearchReport(input: { id: string; userId: string; map: CompanyClusterMap; document: CompanyResearchReportDocument }) {
  const updated = await db.update(companyResearchReports).set({
    status: "complete",
    document: input.document,
    map: input.map,
    mapInput: null,
    failureCode: null,
    updatedAt: new Date(),
  }).where(and(eq(companyResearchReports.id, input.id), eq(companyResearchReports.userId, input.userId), eq(companyResearchReports.status, "mapping"))).returning({ id: companyResearchReports.id });
  return updated[0] ?? null;
}

export async function failCompanyResearchReport(id: string, userId: string, failureCode: string) {
  await db.update(companyResearchReports).set({ status: "failed", failureCode, mapInput: null, updatedAt: new Date() })
    .where(and(eq(companyResearchReports.id, id), eq(companyResearchReports.userId, userId), inArray(companyResearchReports.status, ["researching", "mapping"])));
}

export async function getCompanyResearchReport(userId: string, id: string) {
  return (await db.select().from(companyResearchReports).where(and(eq(companyResearchReports.id, id), eq(companyResearchReports.userId, userId))).limit(1))[0] ?? null;
}

export async function getCompanyResearchMapInput(userId: string, chatId: string, id: string) {
  return (await db.select({ id: companyResearchReports.id, status: companyResearchReports.status, mapInput: companyResearchReports.mapInput })
    .from(companyResearchReports)
    .where(and(eq(companyResearchReports.id, id), eq(companyResearchReports.userId, userId), eq(companyResearchReports.chatId, chatId)))
    .limit(1))[0] ?? null;
}

export async function listCompanyResearchReports(userId: string) {
  return db.select().from(companyResearchReports).where(eq(companyResearchReports.userId, userId)).orderBy(desc(companyResearchReports.createdAt));
}

export async function assertWithinRateLimit(userId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [applicationRuns, companyRuns] = await Promise.all([
    db.select({ id: analysisRuns.id }).from(analysisRuns).where(and(eq(analysisRuns.userId, userId), gte(analysisRuns.createdAt, since))),
    db.select({ id: companyResearchReports.id }).from(companyResearchReports).where(and(eq(companyResearchReports.userId, userId), gte(companyResearchReports.createdAt, since))),
  ]);
  if (applicationRuns.length + companyRuns.length >= appConfig.analysisRateLimitPerHour) throw new Error("ANALYSIS_RATE_LIMIT");
}
