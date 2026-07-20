import "server-only";

import { gateway } from "@ai-sdk/gateway";
import { start } from "workflow/api";
import type { EmbeddingModelUsage, LanguageModelUsage, ProviderMetadata } from "ai";
import { billingConfig } from "@/lib/billing/config";
import { estimatedCostNanoUsd } from "@/lib/billing/pricing";
import { createPendingUsage, nanoUsdFromUsd, settleProviderUsage } from "@/lib/billing/repository";
import type { AiUsageSnapshot } from "@/lib/db/schema";
import { usageReconciliationWorkflow } from "@/workflows/usage-reconciliation";

export type MeteringContext = {
  userId?: string | null;
  reservationId?: string | null;
  feature: string;
  operationId: string;
};

export function gatewayProviderOptions(context: Pick<MeteringContext, "userId" | "feature">) {
  return {
    gateway: {
      ...(context.userId ? { user: context.userId } : {}),
      tags: ["application-signal", context.feature],
    },
  };
}

export function normalizeLanguageUsage(usage: LanguageModelUsage): AiUsageSnapshot {
  return {
    inputTokens: usage.inputTokens,
    inputTokenDetails: {
      noCacheTokens: usage.inputTokenDetails.noCacheTokens,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
    },
    outputTokens: usage.outputTokens,
    outputTokenDetails: {
      textTokens: usage.outputTokenDetails.textTokens,
      reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    },
    totalTokens: usage.totalTokens,
  };
}

export function normalizeEmbeddingUsage(usage: EmbeddingModelUsage): AiUsageSnapshot {
  return { inputTokens: usage.tokens, totalTokens: usage.tokens };
}

function findGenerationId(value: unknown, depth = 0): string | null {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === "string") return /^gen_[a-z0-9]+$/i.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findGenerationId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/generation.?id/i.test(key) && typeof item === "string") return item;
      const found = findGenerationId(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function gatewayGenerationId(responseId: string | null | undefined, providerMetadata?: ProviderMetadata) {
  return findGenerationId(providerMetadata) ?? (responseId?.startsWith("gen_") ? responseId : null);
}

export async function recordAiUsage(input: {
  context: MeteringContext;
  model: string;
  responseId?: string | null;
  providerMetadata?: ProviderMetadata;
  usage: AiUsageSnapshot;
  eventId?: string;
}) {
  const generationId = gatewayGenerationId(input.responseId, input.providerMetadata);
  const idempotencyKey = `ai:${generationId ?? input.eventId ?? `${input.context.operationId}:${crypto.randomUUID()}`}`;
  if (!generationId) {
    // No generation id means getGenerationInfo cannot price this call, so fall back
    // to the gateway model catalog rather than recording the generation as free.
    const estimated = await estimatedCostNanoUsd(input.model, input.usage);
    return settleProviderUsage({
      userId: input.context.userId,
      reservationId: input.context.reservationId,
      feature: input.context.feature,
      provider: "vercel-ai-gateway",
      model: input.model,
      usage: input.usage,
      costNanoUsd: estimated ?? 0,
      idempotencyKey,
      needsReview: estimated === null,
    });
  }
  try {
    const generation = await gateway.getGenerationInfo({ id: generationId });
    return settleProviderUsage({
      userId: input.context.userId,
      reservationId: input.context.reservationId,
      feature: input.context.feature,
      provider: generation.providerName || "vercel-ai-gateway",
      model: generation.model || input.model,
      externalId: generationId,
      usage: input.usage,
      costNanoUsd: nanoUsdFromUsd(generation.totalCost),
      idempotencyKey,
    });
  } catch (cause) {
    if (!billingConfig.enabled || !input.context.userId || !input.context.reservationId) {
      return settleProviderUsage({
        feature: input.context.feature,
        provider: "vercel-ai-gateway",
        model: input.model,
        externalId: generationId,
        usage: input.usage,
        costNanoUsd: 0,
        idempotencyKey,
        needsReview: true,
      });
    }
    await createPendingUsage({
      userId: input.context.userId,
      reservationId: input.context.reservationId,
      feature: input.context.feature,
      provider: "vercel-ai-gateway",
      model: input.model,
      externalId: generationId,
      usage: input.usage,
      idempotencyKey,
    });
    try {
      await start(usageReconciliationWorkflow, [{
        userId: input.context.userId,
        reservationId: input.context.reservationId,
        feature: input.context.feature,
        model: input.model,
        generationId,
        usage: input.usage,
        idempotencyKey,
      }]);
    } catch (workflowError) {
      console.error("AI usage reconciliation could not be queued", {
        generationId,
        cause: workflowError instanceof Error ? workflowError.message : "UNKNOWN_ERROR",
        originalCause: cause instanceof Error ? cause.message : "UNKNOWN_ERROR",
      });
    }
    return null;
  }
}

