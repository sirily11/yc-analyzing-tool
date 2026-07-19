import { z } from "zod";
import { appConfig } from "@/config";
import { getCurrentUser } from "@/lib/auth";
import { createChatDocument, getChat } from "@/lib/db/repository";
import { createDocumentUploadUrls, documentObjectKeys, documentStorageConfig } from "@/lib/storage/chat-documents";
import { sourceFileMetadataSchema } from "@/lib/types/analysis";

const uploadRequestSchema = z.object({
  metadata: sourceFileMetadataSchema.extend({ kind: z.literal("pdf").optional() }),
});

export async function POST(request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { chatId } = await params;
  if (!await getChat(user.id, chatId)) return Response.json({ error: "Chat not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "PDF metadata is required" }, { status: 400 });
  }
  const parsed = uploadRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid PDF metadata" }, { status: 400 });

  const { metadata } = parsed.data;
  if (metadata.size > appConfig.pdf.maxBytes || metadata.pages > appConfig.pdf.maxPages || metadata.characters > appConfig.pdf.maxCharacters || metadata.characters < appConfig.pdf.minCharacters) {
    return Response.json({ error: "PDF exceeds the supported limits" }, { status: 400 });
  }

  try {
    const config = documentStorageConfig();
    const id = crypto.randomUUID();
    const keys = documentObjectKeys(config.prefix, user.id, chatId, id);
    const urls = await createDocumentUploadUrls(keys, config);
    await createChatDocument({ id, userId: user.id, chatId, metadata: { ...metadata, kind: "pdf" }, ...keys });
    return Response.json({ id, ...urls }, { status: 201 });
  } catch (cause) {
    console.error("Failed to prepare retained PDF upload", cause);
    return Response.json({ error: "PDF storage is not configured or unavailable" }, { status: 503 });
  }
}
