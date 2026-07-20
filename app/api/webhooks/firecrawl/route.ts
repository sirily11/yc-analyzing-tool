import { z } from "zod";
import { verifyFirecrawlSignature } from "@/lib/research/firecrawl";
import { handleFirecrawlCompletion } from "@/lib/research/report-research";

export const runtime = "nodejs";
export const maxDuration = 60;

const webhookSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  error: z.string().optional(),
});

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyFirecrawlSignature(rawBody, request.headers.get("x-firecrawl-signature"))) {
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  await handleFirecrawlCompletion({ jobId: parsed.data.id, type: parsed.data.type, error: parsed.data.error });
  return Response.json({ accepted: true });
}
