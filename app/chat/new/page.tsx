import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { createChat } from "@/lib/db/repository";
import { createPageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-dynamic";
export const metadata = createPageMetadata("newAnalysis", "/chat/new", { privatePage: true });

export default async function NewChatPage() {
  const user = await requirePageUser();
  const id = await createChat(user.id);
  redirect(`/chat/${id}`);
}
