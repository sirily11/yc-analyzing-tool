import { getCurrentUser } from "@/lib/auth";
import { MAX_CHAT_TITLE_LENGTH, normalizeChatTitle } from "@/lib/chat-title";
import { deleteChat, listChatDocumentObjectKeys, renameChat } from "@/lib/db/repository";
import { deleteDocumentObjects } from "@/lib/storage/chat-documents";

export async function PATCH(request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "A title is required" }, { status: 400 });
  }

  const requestedTitle = typeof body === "object" && body !== null && "title" in body
    ? (body as { title?: unknown }).title
    : undefined;
  if (typeof requestedTitle !== "string") return Response.json({ error: "A title is required" }, { status: 400 });

  const title = normalizeChatTitle(requestedTitle);
  if (!title) return Response.json({ error: "Title cannot be empty" }, { status: 400 });
  if (title.length > MAX_CHAT_TITLE_LENGTH) return Response.json({ error: `Title must be ${MAX_CHAT_TITLE_LENGTH} characters or fewer` }, { status: 400 });

  const { chatId } = await params;
  const chat = await renameChat(user.id, chatId, title);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
  return Response.json(chat);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { chatId } = await params;
  const documents = await listChatDocumentObjectKeys(user.id, chatId);
  if (documents.length) {
    try {
      await deleteDocumentObjects(documents.flatMap((document) => [document.objectKey, document.extractedObjectKey]));
    } catch (cause) {
      console.error("Failed to delete stored PDFs with conversation", cause);
      return Response.json({ error: "Stored PDFs could not be deleted" }, { status: 502 });
    }
  }
  const chat = await deleteChat(user.id, chatId);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
