import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { summarizeToolError } from "@/lib/ai/tool-log";
import { publishCompanyResearchRun } from "@/lib/analysis/company-research-run";
import { getCompanyResearchReport } from "@/lib/db/repository";
import { companyClusterMapSchema } from "@/lib/types/company-research";

const requestSchema = z.object({ map: companyClusterMapSchema });

export async function POST(request: Request, context: { params: Promise<{ reportId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { reportId } = await context.params;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid company map output" }, { status: 400 });

  const existing = await getCompanyResearchReport(user.id, reportId);
  if (!existing || existing.status !== "mapping") return Response.json({ error: "Company report not found" }, { status: 404 });

  try {
    const result = await publishCompanyResearchRun({
      userId: user.id,
      chatId: existing.chatId,
      reportId,
      map: parsed.data.map,
    });
    return Response.json({ href: result.href }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    console.error("Direct company report publication failed", { reportId, ...summarizeToolError(cause) });
    return Response.json({ error: "The company report could not be published." }, { status: 409 });
  }
}
