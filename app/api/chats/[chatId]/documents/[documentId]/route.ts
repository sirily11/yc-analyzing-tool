import { getCurrentUser } from "@/lib/auth";
import { deleteChatDocumentRecord, getChatDocument, markChatDocumentReady } from "@/lib/db/repository";
import { deleteDocumentObjects, verifyRetainedDocument } from "@/lib/storage/chat-documents";

type RouteContext = { params: Promise<{ chatId: string; documentId: string }> };

export async function PATCH(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { chatId, documentId } = await params;
  const document = await getChatDocument(user.id, chatId, documentId);
  if (!document) return Response.json({ error: "PDF not found" }, { status: 404 });
  if (document.status === "ready") return Response.json({ id: document.id, metadata: document.metadata });

  try {
    await verifyRetainedDocument(document);
    const ready = await markChatDocumentReady(user.id, chatId, documentId);
    if (!ready) return Response.json({ error: "PDF upload could not be finalized" }, { status: 409 });
    return Response.json({ id: document.id, metadata: document.metadata });
  } catch (cause) {
    console.error("Failed to verify retained PDF upload", cause);
    return Response.json({ error: "The uploaded PDF could not be verified" }, { status: 422 });
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { chatId, documentId } = await params;
  const document = await getChatDocument(user.id, chatId, documentId);
  if (!document) return Response.json({ error: "PDF not found" }, { status: 404 });

  try {
    await deleteDocumentObjects([document.objectKey, document.extractedObjectKey]);
    await deleteChatDocumentRecord(user.id, chatId, documentId);
    return new Response(null, { status: 204 });
  } catch (cause) {
    console.error("Failed to delete retained PDF", cause);
    return Response.json({ error: "The stored PDF could not be deleted" }, { status: 502 });
  }
}
