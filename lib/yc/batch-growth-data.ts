import "server-only";
import additionsData from "@/data/yc-batch-additions.json";
import growthData from "@/data/yc-batch-growth.json";
import { parseBatchAdditionsFile, parseBatchGrowthFile, type BatchAdditionCompany } from "@/lib/yc/batch-growth";
import { buildBatchGrowthView, type BatchGrowthView } from "@/lib/yc/batch-growth-chart";

export type BatchGrowthPageData = {
  view: BatchGrowthView;
  additions: BatchAdditionCompany[];
  additionsWindowDays: number;
  additionsSince: string;
  addedInWindow: number;
  directoryTotal: number;
  fastestToFifty: { name: string; days: number } | null;
  latestBatch: { name: string; count: number; days: number } | null;
};

/**
 * The datasets are committed, so a static import is correct: they only change when the cron job
 * pushes a commit, which redeploys the site.
 */
export function loadBatchGrowthPageData(): BatchGrowthPageData {
  const growth = parseBatchGrowthFile(growthData);
  const additions = parseBatchAdditionsFile(additionsData);
  const view = buildBatchGrowthView(growth);

  const fastest = view.series
    .map((series) => ({ name: series.name, days: series.milestones.find((milestone) => milestone.target === 50)?.days }))
    .filter((entry): entry is { name: string; days: number } => typeof entry.days === "number")
    .sort((left, right) => left.days - right.days)[0] ?? null;

  // The newest key in the file is often a placeholder batch with a single company, which makes a
  // poor headline. Use the newest batch that is actually charted.
  const newest = view.series[view.series.length - 1] ?? null;

  return {
    view,
    // The whole window ships to the client so clicking a day can filter without a round trip.
    additions: additions.companies,
    additionsWindowDays: additions.windowDays,
    additionsSince: additions.firstDate,
    addedInWindow: additions.companies.length,
    directoryTotal: additions.days[0]?.total ?? 0,
    fastestToFifty: fastest,
    latestBatch: newest ? { name: newest.name, count: newest.latestCount, days: newest.spanDays } : null,
  };
}
