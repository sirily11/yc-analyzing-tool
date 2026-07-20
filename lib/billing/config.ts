import "server-only";

function integerEnvironment(name: string, fallback: number, minimum = 0) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`INVALID_BILLING_CONFIG:${name}`);
  return value;
}

function numberEnvironment(name: string, fallback: number, minimum = 0) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`INVALID_BILLING_CONFIG:${name}`);
  return value;
}

export const CREDIT_PACKS = [
  { id: "points_1000", points: 1_000, amountCents: 129 },
  { id: "points_5000", points: 5_000, amountCents: 645 },
  { id: "points_10000", points: 10_000, amountCents: 1_290 },
  { id: "points_25000", points: 25_000, amountCents: 3_225 },
] as const;

export type CreditPackId = typeof CREDIT_PACKS[number]["id"];

export const billingConfig = {
  enabled: process.env.BILLING_ENABLED === "true",
  promotionalPoints: integerEnvironment("INITIAL_PROMOTIONAL_POINTS", 200),
  pointsPerProviderUsd: integerEnvironment("POINTS_PER_PROVIDER_USD", 1_000, 1),
  reportFeePoints: integerEnvironment("REPORT_FEE_POINTS", 100),
  reservationMarginBps: integerEnvironment("BILLING_RESERVATION_MARGIN_BPS", 12_500, 10_000),
  chatReservationPoints: integerEnvironment("AI_CHAT_RESERVATION_POINTS", 40, 1),
  applicationReservationPoints: integerEnvironment("APPLICATION_REPORT_RESERVATION_POINTS", 80, 1),
  companyResearchReservationPoints: integerEnvironment("COMPANY_RESEARCH_RESERVATION_POINTS", 300, 1),
  firecrawlUsdPerCredit: numberEnvironment("FIRECRAWL_USD_PER_CREDIT", 0),
  automaticTax: process.env.STRIPE_AUTOMATIC_TAX === "true",
} as const;

export const NANO_USD_PER_USD = 1_000_000_000;
export const NANO_USD_PER_POINT = NANO_USD_PER_USD / billingConfig.pointsPerProviderUsd;

if (!Number.isSafeInteger(NANO_USD_PER_POINT)) {
  throw new Error("POINTS_PER_PROVIDER_USD_MUST_DIVIDE_ONE_BILLION");
}

if (billingConfig.enabled && process.env.FIRECRAWL_API_KEY?.trim() && billingConfig.firecrawlUsdPerCredit <= 0) {
  throw new Error("FIRECRAWL_USD_PER_CREDIT_REQUIRED");
}

export function creditPack(packId: string) {
  return CREDIT_PACKS.find((pack) => pack.id === packId) ?? null;
}

export function reserveWithMargin(points: number) {
  return Math.ceil(points * billingConfig.reservationMarginBps / 10_000);
}
