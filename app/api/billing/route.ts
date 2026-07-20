import { getCurrentUser } from "@/lib/auth";
import { getBillingSummary } from "@/lib/billing/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const summary = await getBillingSummary(user.id);
  return Response.json(summary, { headers: { "Cache-Control": "private, no-store" } });
}

