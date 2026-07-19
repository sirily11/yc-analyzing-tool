"use server";

import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth";
import { createChat } from "@/lib/db/repository";

export async function startAnalysis() {
  const user = await requirePageUser();
  const id = await createChat(user.id);
  redirect(`/chat/${id}`);
}
