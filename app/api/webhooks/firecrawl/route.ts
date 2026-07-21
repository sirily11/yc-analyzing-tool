import { z } from "zod";
import { verifyFirecrawlSignature } from "@/lib/research/firecrawl";
import { handleFirecrawlCompletion } from "@/lib/research/report-research";
import { researchLog } from "@/lib/research/log";

export const runtime = "nodejs";
export const maxDuration = 60;

const webhookSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  error: z.string().optional(),
  metadata: z.object({
    reportId: z.string().min(1),
    kind: z.enum(["crawl", "batch-scrape"]),
    comparableCompanyId: z.number().int().optional(),
    targets: z.array(z.object({
      companyId: z.number().int(),
      url: z.string().url(),
      sourceType: z.enum(["yc-profile", "company-website", "founder-source", "related-coverage"]),
    })).min(1),
  }).optional(),
});

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyFirecrawlSignature(rawBody, request.headers.get("x-firecrawl-signature"))) {
    researchLog("warn", "firecrawl.webhook.rejected", { reason: "INVALID_SIGNATURE" });
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    researchLog("warn", "firecrawl.webhook.rejected", { reason: "INVALID_JSON" });
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) {
    researchLog("warn", "firecrawl.webhook.rejected", { reason: "INVALID_PAYLOAD" });
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }
  try {
    await handleFirecrawlCompletion({ jobId: parsed.data.id, type: parsed.data.type, error: parsed.data.error, metadata: parsed.data.metadata });
    return Response.json({ accepted: true });
  } catch {
    // Firecrawl retries non-2xx webhook deliveries. Do not acknowledge a
    // terminal event until its DB state and provider usage are durable.
    researchLog("warn", "firecrawl.webhook.retry_requested", { firecrawlJobId: parsed.data.id, type: parsed.data.type });
    return Response.json({ error: "Webhook processing unavailable" }, { status: 503 });
  }
}
