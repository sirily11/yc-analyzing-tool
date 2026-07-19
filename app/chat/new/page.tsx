import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { createChat } from "@/lib/db/repository";

export const dynamic = "force-dynamic";

export default async function NewChatPage() {
  const user = await requirePageUser();
  const id = await createChat(user.id);
  redirect(`/chat/${id}`);
}
