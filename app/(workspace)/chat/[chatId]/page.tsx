import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChatWorkspace } from "@/components/chat-workspace";
import { getDashboardShellData } from "@/lib/dashboard-shell";
import { getChat, listReadyChatDocumentIds, loadMessages } from "@/lib/db/repository";
import { createPageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

type ChatPageProps = { params: Promise<{ chatId: string }> };

export async function generateMetadata({ params }: ChatPageProps): Promise<Metadata> {
  const { chatId } = await params;
  return createPageMetadata("chat", `/chat/${encodeURIComponent(chatId)}`, { privatePage: true });
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { user } = await getDashboardShellData(); const { chatId } = await params;
  const [chat, messages, documents] = await Promise.all([getChat(user.id, chatId), loadMessages(user.id, chatId), listReadyChatDocumentIds(user.id, chatId)]);
  if (!chat) notFound();
  return <ChatWorkspace chatId={chatId} initialTitle={chat.title} initialMessages={messages} initialDocumentIds={documents.map((document) => document.id)} />;
}
