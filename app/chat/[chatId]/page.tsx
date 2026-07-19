import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ChatWorkspace } from "@/components/chat-workspace";
import { requirePageUser } from "@/lib/auth";
import { getChat, listChats, listReadyChatDocumentIds, loadMessages } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const user = await requirePageUser(); const { chatId } = await params;
  const [chat, chats, messages, documents] = await Promise.all([getChat(user.id, chatId), listChats(user.id), loadMessages(user.id, chatId), listReadyChatDocumentIds(user.id, chatId)]);
  if (!chat) notFound();
  return <AppShell user={user} chats={chats}><ChatWorkspace chatId={chatId} initialTitle={chat.title} initialMessages={messages} initialDocumentIds={documents.map((document) => document.id)} /></AppShell>;
}
