import { readFile, unlink } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("prepaid credit accounting", () => {
  let repository: typeof import("@/lib/billing/repository");
  let client: typeof import("@/lib/db")["client"];
  const databasePath = `/tmp/application-signal-billing-${process.pid}-${crypto.randomUUID()}.db`;

  beforeAll(async () => {
    process.env.BILLING_ENABLED = "true";
    process.env.INITIAL_PROMOTIONAL_POINTS = "200";
    process.env.POINTS_PER_PROVIDER_USD = "1000";
    process.env.REPORT_FEE_POINTS = "100";
    process.env.TURSO_DATABASE_URL = `file:${databasePath}`;
    vi.resetModules();
    ({ client } = await import("@/lib/db"));
    for (const file of ["0005_mighty_bastion.sql", "0006_nervous_wolfpack.sql"]) {
      const migration = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
      await client.executeMultiple(migration.replaceAll("--> statement-breakpoint", ""));
    }
    repository = await import("@/lib/billing/repository");
  });

  afterAll(async () => {
    await client.close();
    await unlink(databasePath).catch(() => undefined);
  });

  it("grants starter points once and prevents over-reservation", async () => {
    const first = await repository.ensureBillingAccount("user-1");
    const second = await repository.ensureBillingAccount("user-1");
    expect(first.balancePoints).toBe(200);
    expect(second.balancePoints).toBe(200);

    await repository.reserveCredits({
      userId: "user-1",
      operationKey: "report:user-1:1",
      feature: "Application report",
      points: 200,
      reportFeePoints: 100,
      scopeId: "report-1",
    });
    await expect(repository.reserveCredits({
      userId: "user-1",
      operationKey: "chat:user-1:2",
      feature: "Chat",
      points: 1,
    })).rejects.toMatchObject({ name: "InsufficientCreditsError", availablePoints: 0, requiredPoints: 1 });
  });

  it("carries sub-point cost, settles idempotently, and charges a report fee once", async () => {
    const reservation = await repository.reserveCredits({
      userId: "user-2",
      operationKey: "report:user-2:1",
      feature: "Application report",
      points: 200,
      reportFeePoints: 100,
      scopeId: "report-2",
    });
    expect(reservation).not.toBeNull();

    await repository.settleProviderUsage({
      userId: "user-2", reservationId: reservation!.id, feature: "Drafting",
      provider: "openai", costNanoUsd: 500_000, idempotencyKey: "ai:one",
    });
    await repository.settleProviderUsage({
      userId: "user-2", reservationId: reservation!.id, feature: "Drafting",
      provider: "openai", costNanoUsd: 500_000, idempotencyKey: "ai:two",
    });
    await repository.settleProviderUsage({
      userId: "user-2", reservationId: reservation!.id, feature: "Drafting",
      provider: "openai", costNanoUsd: 500_000, idempotencyKey: "ai:two",
    });
    await repository.closeReservation({
      reservationId: reservation!.id,
      userId: "user-2",
      success: true,
      scopeId: "report-2",
      chargeReportFee: true,
    });
    await repository.closeReservation({
      reservationId: reservation!.id,
      userId: "user-2",
      success: true,
      scopeId: "report-2",
      chargeReportFee: true,
    });

    const summary = await repository.getBillingSummary("user-2");
    expect(summary.balancePoints).toBe(99);
    expect(summary.reservedPoints).toBe(0);
    expect(summary.ledger.filter((entry) => entry.kind === "provider_usage")).toHaveLength(1);
    expect(summary.ledger.filter((entry) => entry.kind === "report_fee")).toHaveLength(1);
  });

  it("uses cumulative floor rounding for proportional reversals", () => {
    expect(repository.proportionalPointReversal(1_000, 129, 1)).toBe(7);
    expect(repository.proportionalPointReversal(1_000, 129, 129)).toBe(1_000);
  });

  it("keeps credits reserved until delayed provider accounting settles", async () => {
    const reservation = await repository.reserveCredits({
      userId: "user-3",
      operationKey: "report:user-3:1",
      feature: "Application report",
      points: 200,
      reportFeePoints: 100,
      scopeId: "report-3",
    });
    await repository.createPendingUsage({
      userId: "user-3",
      reservationId: reservation!.id,
      feature: "Drafting",
      provider: "vercel-ai-gateway",
      model: "openai/test",
      externalId: "gen_delayed",
      idempotencyKey: "ai:delayed",
    });
    await repository.closeReservation({
      reservationId: reservation!.id,
      userId: "user-3",
      success: true,
      scopeId: "report-3",
      chargeReportFee: true,
    });
    expect((await repository.getBillingSummary("user-3")).reservedPoints).toBe(200);

    await repository.settleProviderUsage({
      userId: "user-3",
      reservationId: reservation!.id,
      feature: "Drafting",
      provider: "openai",
      externalId: "gen_delayed",
      costNanoUsd: 1_000_000,
      idempotencyKey: "ai:delayed",
    });
    await repository.finalizeRequestedReservation(reservation!.id, "user-3");
    const summary = await repository.getBillingSummary("user-3");
    expect(summary.balancePoints).toBe(99);
    expect(summary.reservedPoints).toBe(0);
  });

  it("moves later pending usage to review after the reservation is parked", async () => {
    const reservation = await repository.reserveCredits({
      userId: "user-4",
      operationKey: "report:user-4:1",
      feature: "Application report",
      points: 200,
      reportFeePoints: 100,
      scopeId: "report-4",
    });
    for (const idempotencyKey of ["firecrawl:search:one", "firecrawl:search:two"]) {
      await repository.createPendingUsage({
        userId: "user-4",
        reservationId: reservation!.id,
        feature: "Firecrawl comparable search",
        provider: "firecrawl",
        idempotencyKey,
      });
    }
    await repository.markUsageNeedsReview("firecrawl:search:one");
    const later = await repository.settleProviderUsage({
      userId: "user-4",
      reservationId: reservation!.id,
      feature: "Firecrawl comparable search",
      provider: "firecrawl",
      externalId: "search-two",
      providerCredits: 1,
      costNanoUsd: 1_000_000,
      idempotencyKey: "firecrawl:search:two",
    });

    expect(later?.status).toBe("needs_review");
    expect((await repository.getBillingSummary("user-4")).reservedPoints).toBe(200);
  });
});
