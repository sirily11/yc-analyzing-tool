import { cache } from "react";
import { requirePageUser } from "@/lib/auth";
import { listChats } from "@/lib/db/repository";

export const getDashboardShellData = cache(async () => {
  const user = await requirePageUser();
  const chats = await listChats(user.id);
  return { user, chats };
});
