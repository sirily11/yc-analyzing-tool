import { gateway } from "@ai-sdk/gateway";
import { sleep } from "workflow";
import { finalizeRequestedReservation, markUsageNeedsReview, nanoUsdFromUsd, settleProviderUsage } from "@/lib/billing/repository";
import type { AiUsageSnapshot } from "@/lib/db/schema";

export type UsageReconciliationInput = {
  userId: string;
  reservationId: string;
  feature: string;
  model: string;
  generationId: string;
  usage: AiUsageSnapshot;
  idempotencyKey: string;
};

export async function reconcileAiUsageStep(input: UsageReconciliationInput) {
  "use step";
  const generation = await gateway.getGenerationInfo({ id: input.generationId });
  await settleProviderUsage({
    userId: input.userId,
    reservationId: input.reservationId,
    feature: input.feature,
    provider: generation.providerName || "vercel-ai-gateway",
    model: generation.model || input.model,
    externalId: input.generationId,
    usage: input.usage,
    costNanoUsd: nanoUsdFromUsd(generation.totalCost),
    idempotencyKey: input.idempotencyKey,
  });
  await finalizeRequestedReservation(input.reservationId, input.userId);
}

export async function markAiUsageForReviewStep(idempotencyKey: string) {
  "use step";
  await markUsageNeedsReview(idempotencyKey);
}

export async function usageReconciliationWorkflow(input: UsageReconciliationInput) {
  "use workflow";
  for (const delay of ["30s", "5m", "1h", "6h"] as const) {
    await sleep(delay);
    try {
      await reconcileAiUsageStep(input);
      return { status: "settled" as const };
    } catch {
      // Generation accounting can lag the streamed response. Retry durably.
    }
  }
  await markAiUsageForReviewStep(input.idempotencyKey);
  return { status: "needs_review" as const };
}
