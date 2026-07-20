import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ChatWorkspace } from "@/components/chat-workspace";
import { requirePageUser } from "@/lib/auth";
import { getChat, listChats, listReadyChatDocumentIds, loadMessages } from "@/lib/db/repository";
import { createPageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

type ChatPageProps = { params: Promise<{ chatId: string }> };

export async function generateMetadata({ params }: ChatPageProps): Promise<Metadata> {
  const { chatId } = await params;
  return createPageMetadata("chat", `/chat/${encodeURIComponent(chatId)}`, { privatePage: true });
}

export default async function ChatPage({ params }: ChatPageProps) {
  const user = await requirePageUser(); const { chatId } = await params;
  const [chat, chats, messages, documents] = await Promise.all([getChat(user.id, chatId), listChats(user.id), loadMessages(user.id, chatId), listReadyChatDocumentIds(user.id, chatId)]);
  if (!chat) notFound();
  return <AppShell user={user} chats={chats}><ChatWorkspace chatId={chatId} initialTitle={chat.title} initialMessages={messages} initialDocumentIds={documents.map((document) => document.id)} /></AppShell>;
}
