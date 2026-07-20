import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { billingConfig, CREDIT_PACKS, NANO_USD_PER_POINT } from "@/lib/billing/config";
import { InsufficientCreditsError } from "@/lib/billing/errors";
import { db } from "@/lib/db";
import {
  billingAccounts,
  billingTopups,
  creditReservations,
  pointsLedger,
  stripeWebhookEvents,
  usageEvents,
  type AiUsageSnapshot,
} from "@/lib/db/schema";

export type UsageFundingScope = "user" | "platform";

export function nanoUsdFromUsd(usd: number) {
  if (!Number.isFinite(usd) || usd < 0) throw new Error("INVALID_PROVIDER_COST");
  return Math.round(usd * 1_000_000_000);
}

export function pointsFromCost(costNanoUsd: number, remainderNanoUsd = 0) {
  const total = costNanoUsd + remainderNanoUsd;
  return {
    points: Math.floor(total / NANO_USD_PER_POINT),
    remainderNanoUsd: total % NANO_USD_PER_POINT,
  };
}

export function proportionalPointReversal(points: number, amountCents: number, refundedCents: number) {
  if (amountCents <= 0 || refundedCents <= 0) return 0;
  return Math.floor(Math.min(refundedCents, amountCents) * points / amountCents);
}

export async function ensureBillingAccount(userId: string) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(billingAccounts).values({
      userId,
      balancePoints: billingConfig.promotionalPoints,
      reservedPoints: 0,
      costRemainderNanoUsd: 0,
      promotionalGrantAt: now,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing().returning();
    if (inserted.length && billingConfig.promotionalPoints > 0) {
      await tx.insert(pointsLedger).values({
        id: crypto.randomUUID(),
        userId,
        kind: "promotional_grant",
        pointsDelta: billingConfig.promotionalPoints,
        balanceAfter: billingConfig.promotionalPoints,
        description: "Welcome credit",
        referenceId: null,
        idempotencyKey: `promotional-grant:${userId}`,
        createdAt: now,
      }).onConflictDoNothing();
    }
    const account = (await tx.select().from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1))[0];
    if (!account) throw new Error("BILLING_ACCOUNT_NOT_CREATED");
    return account;
  });
}

export async function getBillingSummary(userId: string) {
  const account = await ensureBillingAccount(userId);
  const [ledger, topups] = await Promise.all([
    db.select().from(pointsLedger).where(eq(pointsLedger.userId, userId)).orderBy(desc(pointsLedger.createdAt)).limit(100),
    db.select().from(billingTopups).where(eq(billingTopups.userId, userId)).orderBy(desc(billingTopups.createdAt)).limit(50),
  ]);
  return {
    enabled: billingConfig.enabled,
    balancePoints: account.balancePoints,
    reservedPoints: account.reservedPoints,
    availablePoints: account.balancePoints - account.reservedPoints,
    packs: CREDIT_PACKS.map((pack) => ({ ...pack })),
    ledger,
    topups,
  };
}

export async function getBillingAccount(userId: string) {
  return ensureBillingAccount(userId);
}

export async function reserveCredits(input: {
  userId: string;
  operationKey: string;
  feature: string;
  points: number;
  reportFeePoints?: number;
  scopeId?: string | null;
}) {
  if (!billingConfig.enabled) return null;
  if (!Number.isSafeInteger(input.points) || input.points <= 0) throw new Error("INVALID_CREDIT_RESERVATION");
  const reportFeePoints = input.reportFeePoints ?? 0;
  if (reportFeePoints < 0 || reportFeePoints > input.points) throw new Error("INVALID_REPORT_FEE_RESERVATION");
  await ensureBillingAccount(input.userId);
  const now = new Date();
  return db.transaction(async (tx) => {
    const existing = (await tx.select().from(creditReservations).where(eq(creditReservations.operationKey, input.operationKey)).limit(1))[0];
    if (existing) {
      if (existing.userId !== input.userId) throw new Error("BILLING_OPERATION_OWNERSHIP_MISMATCH");
      return existing;
    }
    const reserved = await tx.update(billingAccounts).set({
      reservedPoints: sql`${billingAccounts.reservedPoints} + ${input.points}`,
      updatedAt: now,
    }).where(and(
      eq(billingAccounts.userId, input.userId),
      sql`${billingAccounts.balancePoints} - ${billingAccounts.reservedPoints} >= ${input.points}`,
      sql`${billingAccounts.balancePoints} >= 0`,
    )).returning();
    if (!reserved.length) {
      const account = (await tx.select().from(billingAccounts).where(eq(billingAccounts.userId, input.userId)).limit(1))[0];
      throw new InsufficientCreditsError(
        account ? Math.max(0, account.balancePoints - account.reservedPoints) : 0,
        input.points,
      );
    }
    const id = crypto.randomUUID();
    const rows = await tx.insert(creditReservations).values({
      id,
      userId: input.userId,
      operationKey: input.operationKey,
      feature: input.feature,
      scopeId: input.scopeId ?? null,
      reservedPoints: input.points,
      settledPoints: 0,
      reportFeePoints,
      status: "open",
      createdAt: now,
      updatedAt: now,
    }).returning();
    return rows[0];
  });
}

export async function attachReservationScope(reservationId: string, userId: string, scopeId: string) {
  return (await db.update(creditReservations).set({ scopeId, updatedAt: new Date() }).where(and(
    eq(creditReservations.id, reservationId),
    eq(creditReservations.userId, userId),
    eq(creditReservations.status, "open"),
  )).returning())[0] ?? null;
}

export async function findOpenReservationByScope(userId: string, scopeId: string) {
  return (await db.select().from(creditReservations).where(and(
    eq(creditReservations.userId, userId),
    eq(creditReservations.scopeId, scopeId),
    eq(creditReservations.status, "open"),
  )).limit(1))[0] ?? null;
}

async function insertPlatformUsage(input: {
  feature: string;
  provider: string;
  model?: string | null;
  externalId?: string | null;
  usage?: AiUsageSnapshot | null;
  providerCredits?: number | null;
  costNanoUsd: number;
  idempotencyKey: string;
  status?: "settled" | "needs_review";
}, executor: Pick<typeof db, "insert"> = db) {
  const now = new Date();
  const inserted = await executor.insert(usageEvents).values({
    id: crypto.randomUUID(),
    userId: null,
    reservationId: null,
    fundingScope: "platform",
    provider: input.provider,
    feature: input.feature,
    model: input.model ?? null,
    externalId: input.externalId ?? null,
    usage: input.usage ?? null,
    providerCredits: input.providerCredits ?? null,
    costNanoUsd: input.costNanoUsd,
    chargedPoints: 0,
    status: input.status ?? "settled",
    idempotencyKey: input.idempotencyKey,
    createdAt: now,
    settledAt: input.status === "needs_review" ? null : now,
  }).onConflictDoNothing().returning();
  return inserted[0] ?? null;
}

export async function settleProviderUsage(input: {
  userId?: string | null;
  reservationId?: string | null;
  feature: string;
  provider: string;
  model?: string | null;
  externalId?: string | null;
  usage?: AiUsageSnapshot | null;
  providerCredits?: number | null;
  costNanoUsd: number;
  idempotencyKey: string;
  needsReview?: boolean;
}) {
  if (!billingConfig.enabled || !input.userId || !input.reservationId) {
    return insertPlatformUsage({ ...input, status: input.needsReview ? "needs_review" : "settled" });
  }
  const userId = input.userId;
  const reservationId = input.reservationId;
  const now = new Date();
  return db.transaction(async (tx) => {
    const existing = (await tx.select().from(usageEvents).where(eq(usageEvents.idempotencyKey, input.idempotencyKey)).limit(1))[0];
    if (existing && existing.status !== "pending") return existing;
    const reservation = (await tx.select().from(creditReservations).where(and(
      eq(creditReservations.id, reservationId),
      eq(creditReservations.userId, userId),
    )).limit(1))[0];
    // A reservation already parked for review (or closed) must not fail later steps of the
    // same run — record the usage for manual reconciliation instead of throwing.
    if (!reservation || reservation.status !== "open") return insertPlatformUsage({ ...input, status: "needs_review" }, tx);
    const account = (await tx.select().from(billingAccounts).where(eq(billingAccounts.userId, userId)).limit(1))[0];
    if (!account) throw new Error("BILLING_ACCOUNT_NOT_FOUND");
    if (input.needsReview) {
      const rows = await tx.insert(usageEvents).values({
        id: crypto.randomUUID(), userId, reservationId,
        fundingScope: "user", provider: input.provider, feature: input.feature,
        model: input.model ?? null, externalId: input.externalId ?? null, usage: input.usage ?? null,
        providerCredits: input.providerCredits ?? null, costNanoUsd: input.costNanoUsd,
        chargedPoints: 0, status: "needs_review", idempotencyKey: input.idempotencyKey,
        createdAt: now, settledAt: null,
      }).returning();
      await tx.update(creditReservations).set({ status: "needs_review", updatedAt: now }).where(eq(creditReservations.id, reservation.id));
      return rows[0];
    }
    const conversion = pointsFromCost(input.costNanoUsd, account.costRemainderNanoUsd);
    const providerCapacity = reservation.reservedPoints - reservation.reportFeePoints - reservation.settledPoints;
    if (conversion.points > providerCapacity) throw new Error("BILLING_RESERVATION_EXCEEDED");
    const balanceAfter = account.balancePoints - conversion.points;
    if (balanceAfter < 0) throw new Error("BILLING_BALANCE_EXCEEDED");
    await tx.update(billingAccounts).set({
      balancePoints: balanceAfter,
      costRemainderNanoUsd: conversion.remainderNanoUsd,
      updatedAt: now,
    }).where(eq(billingAccounts.userId, userId));
    await tx.update(creditReservations).set({
      settledPoints: reservation.settledPoints + conversion.points,
      updatedAt: now,
    }).where(eq(creditReservations.id, reservation.id));
    const rows = existing
      ? await tx.update(usageEvents).set({
          provider: input.provider, model: input.model ?? existing.model,
          externalId: input.externalId ?? existing.externalId, usage: input.usage ?? existing.usage,
          providerCredits: input.providerCredits ?? existing.providerCredits,
          costNanoUsd: input.costNanoUsd, chargedPoints: conversion.points,
          status: "settled", settledAt: now,
        }).where(eq(usageEvents.id, existing.id)).returning()
      : await tx.insert(usageEvents).values({
          id: crypto.randomUUID(), userId, reservationId,
          fundingScope: "user", provider: input.provider, feature: input.feature,
          model: input.model ?? null, externalId: input.externalId ?? null, usage: input.usage ?? null,
          providerCredits: input.providerCredits ?? null, costNanoUsd: input.costNanoUsd,
          chargedPoints: conversion.points, status: "settled", idempotencyKey: input.idempotencyKey,
          createdAt: now, settledAt: now,
        }).returning();
    if (conversion.points > 0) {
      await tx.insert(pointsLedger).values({
        id: crypto.randomUUID(), userId, kind: "provider_usage",
        pointsDelta: -conversion.points, balanceAfter,
        description: input.feature, referenceId: reservation.scopeId ?? reservation.id,
        idempotencyKey: `ledger:${input.idempotencyKey}`, createdAt: now,
      });
    }
    return rows[0];
  });
}

export async function createPendingUsage(input: {
  userId: string;
  reservationId: string;
  feature: string;
  provider: string;
  model?: string | null;
  externalId?: string | null;
  usage?: AiUsageSnapshot | null;
  idempotencyKey: string;
}) {
  const now = new Date();
  return (await db.insert(usageEvents).values({
    id: crypto.randomUUID(), userId: input.userId, reservationId: input.reservationId,
    fundingScope: "user", provider: input.provider, feature: input.feature,
    model: input.model ?? null, externalId: input.externalId ?? null,
    usage: input.usage ?? null, providerCredits: null, costNanoUsd: 0,
    chargedPoints: 0, status: "pending", idempotencyKey: input.idempotencyKey,
    createdAt: now, settledAt: null,
  }).onConflictDoNothing().returning())[0] ?? null;
}

export async function markUsageNeedsReview(idempotencyKey: string) {
  return db.transaction(async (tx) => {
    const event = (await tx.select().from(usageEvents).where(eq(usageEvents.idempotencyKey, idempotencyKey)).limit(1))[0];
    if (!event || event.status !== "pending") return event ?? null;
    await tx.update(usageEvents).set({ status: "needs_review" }).where(eq(usageEvents.id, event.id));
    if (event.reservationId) {
      await tx.update(creditReservations).set({ status: "needs_review", updatedAt: new Date() }).where(and(
        eq(creditReservations.id, event.reservationId),
        eq(creditReservations.status, "open"),
      ));
    }
    return { ...event, status: "needs_review" as const };
  });
}

export async function closeReservation(input: {
  reservationId: string;
  userId: string;
  success: boolean;
  scopeId?: string | null;
  chargeReportFee?: boolean;
}) {
  if (!billingConfig.enabled) return null;
  const now = new Date();
  return db.transaction(async (tx) => {
    const reservation = (await tx.select().from(creditReservations).where(and(
      eq(creditReservations.id, input.reservationId),
      eq(creditReservations.userId, input.userId),
    )).limit(1))[0];
    if (!reservation || reservation.status !== "open") return reservation ?? null;
    const pendingUsage = (await tx.select({ id: usageEvents.id }).from(usageEvents).where(and(
      eq(usageEvents.reservationId, reservation.id),
      eq(usageEvents.status, "pending"),
    )).limit(1))[0];
    if (pendingUsage) {
      const rows = await tx.update(creditReservations).set({
        scopeId: input.scopeId ?? reservation.scopeId,
        closeRequestedSuccess: input.success,
        closeRequestedReportFee: Boolean(input.chargeReportFee),
        closeRequestedAt: now,
        updatedAt: now,
      }).where(eq(creditReservations.id, reservation.id)).returning();
      return rows[0] ?? reservation;
    }
    const scopeId = input.scopeId ?? reservation.scopeId;
    const feeKey = `report-fee:${scopeId ?? reservation.id}`;
    const existingFee = input.success && input.chargeReportFee
      ? (await tx.select({ id: pointsLedger.id }).from(pointsLedger).where(eq(pointsLedger.idempotencyKey, feeKey)).limit(1))[0]
      : null;
    const fee = input.success && input.chargeReportFee && !existingFee ? reservation.reportFeePoints : 0;
    const account = (await tx.select().from(billingAccounts).where(eq(billingAccounts.userId, input.userId)).limit(1))[0];
    if (!account) throw new Error("BILLING_ACCOUNT_NOT_FOUND");
    const balanceAfter = account.balancePoints - fee;
    if (balanceAfter < 0) throw new Error("BILLING_BALANCE_EXCEEDED");
    await tx.update(billingAccounts).set({
      balancePoints: balanceAfter,
      reservedPoints: sql`${billingAccounts.reservedPoints} - ${reservation.reservedPoints}`,
      updatedAt: now,
    }).where(eq(billingAccounts.userId, input.userId));
    if (fee > 0) {
      await tx.insert(pointsLedger).values({
        id: crypto.randomUUID(), userId: input.userId, kind: "report_fee",
        pointsDelta: -fee, balanceAfter, description: "Report generation fee",
        referenceId: scopeId, idempotencyKey: feeKey, createdAt: now,
      }).onConflictDoNothing();
    }
    const rows = await tx.update(creditReservations).set({
      scopeId, settledPoints: reservation.settledPoints + fee,
      status: input.success ? "settled" : "released",
      closeRequestedSuccess: null, closeRequestedReportFee: false, closeRequestedAt: null,
      updatedAt: now, closedAt: now,
    }).where(eq(creditReservations.id, reservation.id)).returning();
    return rows[0] ?? null;
  });
}

export async function finalizeRequestedReservation(reservationId: string, userId: string) {
  const reservation = (await db.select().from(creditReservations).where(and(
    eq(creditReservations.id, reservationId),
    eq(creditReservations.userId, userId),
  )).limit(1))[0];
  if (!reservation || reservation.status !== "open" || reservation.closeRequestedSuccess === null) return reservation ?? null;
  return closeReservation({
    reservationId,
    userId,
    success: reservation.closeRequestedSuccess,
    scopeId: reservation.scopeId,
    chargeReportFee: reservation.closeRequestedReportFee,
  });
}

export async function setStripeCustomerId(userId: string, stripeCustomerId: string) {
  await ensureBillingAccount(userId);
  return (await db.update(billingAccounts).set({ stripeCustomerId, updatedAt: new Date() }).where(eq(billingAccounts.userId, userId)).returning())[0] ?? null;
}

export async function createBillingTopup(input: { userId: string; packId: string; points: number; amountCents: number }) {
  const now = new Date();
  const id = crypto.randomUUID();
  await db.insert(billingTopups).values({ id, ...input, currency: "usd", status: "pending", createdAt: now, updatedAt: now });
  return id;
}

export async function setTopupCheckoutSession(topupId: string, userId: string, sessionId: string) {
  return (await db.update(billingTopups).set({ stripeCheckoutSessionId: sessionId, updatedAt: new Date() }).where(and(eq(billingTopups.id, topupId), eq(billingTopups.userId, userId))).returning())[0] ?? null;
}

export async function failTopupByCheckoutSession(sessionId: string) {
  return (await db.update(billingTopups).set({ status: "failed", updatedAt: new Date() }).where(and(
    eq(billingTopups.stripeCheckoutSessionId, sessionId),
    eq(billingTopups.status, "pending"),
  )).returning())[0] ?? null;
}

export async function beginStripeEvent(input: { id: string; type: string; objectId?: string | null }) {
  const inserted = await db.insert(stripeWebhookEvents).values({
    id: input.id, type: input.type, objectId: input.objectId ?? null,
    status: "processing", createdAt: new Date(),
  }).onConflictDoNothing().returning();
  if (inserted.length > 0) return true;
  const retry = await db.update(stripeWebhookEvents).set({
    status: "processing", failureCode: null, processedAt: null,
  }).where(and(eq(stripeWebhookEvents.id, input.id), eq(stripeWebhookEvents.status, "failed"))).returning();
  return retry.length > 0;
}

export async function finishStripeEvent(id: string, status: "processed" | "ignored" | "failed", failureCode?: string | null) {
  await db.update(stripeWebhookEvents).set({ status, failureCode: failureCode ?? null, processedAt: new Date() }).where(eq(stripeWebhookEvents.id, id));
}

export async function fulfillTopup(input: {
  topupId: string;
  sessionId?: string | null;
  paymentIntentId?: string | null;
  invoiceId?: string | null;
  hostedInvoiceUrl?: string | null;
  invoicePdfUrl?: string | null;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const topup = (await tx.select().from(billingTopups).where(eq(billingTopups.id, input.topupId)).limit(1))[0];
    if (!topup) return null;
    if (topup.status === "paid" || topup.status === "refunded" || topup.status === "disputed") return topup;
    const account = await tx.update(billingAccounts).set({
      balancePoints: sql`${billingAccounts.balancePoints} + ${topup.points}`,
      updatedAt: now,
    }).where(eq(billingAccounts.userId, topup.userId)).returning();
    if (!account.length) throw new Error("BILLING_ACCOUNT_NOT_FOUND");
    await tx.insert(pointsLedger).values({
      id: crypto.randomUUID(), userId: topup.userId, kind: "top_up",
      pointsDelta: topup.points, balanceAfter: account[0].balancePoints,
      description: `${topup.points.toLocaleString("en-US")} point top-up`, referenceId: topup.id,
      idempotencyKey: `topup:${topup.id}`, createdAt: now,
    }).onConflictDoNothing();
    const rows = await tx.update(billingTopups).set({
      status: "paid", stripeCheckoutSessionId: input.sessionId ?? topup.stripeCheckoutSessionId,
      stripePaymentIntentId: input.paymentIntentId ?? topup.stripePaymentIntentId,
      stripeInvoiceId: input.invoiceId ?? topup.stripeInvoiceId,
      hostedInvoiceUrl: input.hostedInvoiceUrl ?? topup.hostedInvoiceUrl,
      invoicePdfUrl: input.invoicePdfUrl ?? topup.invoicePdfUrl,
      updatedAt: now, paidAt: topup.paidAt ?? now,
    }).where(eq(billingTopups.id, topup.id)).returning();
    return rows[0];
  });
}

export async function updateTopupInvoice(input: { invoiceId: string; topupId?: string | null; paymentIntentId?: string | null; hostedInvoiceUrl?: string | null; invoicePdfUrl?: string | null }) {
  const condition = input.topupId
    ? eq(billingTopups.id, input.topupId)
    : input.paymentIntentId
    ? eq(billingTopups.stripePaymentIntentId, input.paymentIntentId)
    : eq(billingTopups.stripeInvoiceId, input.invoiceId);
  return (await db.update(billingTopups).set({
    stripeInvoiceId: input.invoiceId,
    hostedInvoiceUrl: input.hostedInvoiceUrl ?? null,
    invoicePdfUrl: input.invoicePdfUrl ?? null,
    updatedAt: new Date(),
  }).where(condition).returning())[0] ?? null;
}

export async function reverseTopupPoints(input: {
  paymentIntentId: string;
  refundedAmountCents: number;
  kind: "refund" | "dispute" | "dispute_reversal";
  eventId: string;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const topup = (await tx.select().from(billingTopups).where(eq(billingTopups.stripePaymentIntentId, input.paymentIntentId)).limit(1))[0];
    if (!topup) return null;
    const targetReversal = input.kind === "dispute_reversal"
      ? 0
      : proportionalPointReversal(topup.points, topup.amountCents, input.refundedAmountCents);
    const pointDelta = topup.reversedPoints - targetReversal;
    if (pointDelta === 0) return topup;
    const account = await tx.update(billingAccounts).set({
      balancePoints: sql`${billingAccounts.balancePoints} + ${pointDelta}`,
      updatedAt: now,
    }).where(eq(billingAccounts.userId, topup.userId)).returning();
    if (!account.length) throw new Error("BILLING_ACCOUNT_NOT_FOUND");
    await tx.insert(pointsLedger).values({
      id: crypto.randomUUID(), userId: topup.userId,
      kind: input.kind, pointsDelta: pointDelta, balanceAfter: account[0].balancePoints,
      description: input.kind === "refund" ? "Top-up refund" : input.kind === "dispute" ? "Disputed top-up" : "Dispute reversed",
      referenceId: topup.id, idempotencyKey: `stripe:${input.eventId}`, createdAt: now,
    }).onConflictDoNothing();
    const rows = await tx.update(billingTopups).set({
      refundedAmountCents: input.kind === "dispute_reversal" ? 0 : input.refundedAmountCents,
      reversedPoints: targetReversal,
      status: input.kind === "dispute_reversal" ? "paid" : input.kind === "dispute" ? "disputed" : targetReversal >= topup.points ? "refunded" : "paid",
      updatedAt: now,
    }).where(eq(billingTopups.id, topup.id)).returning();
    return rows[0];
  });
}
