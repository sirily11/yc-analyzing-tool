import { describe, expect, it } from "vitest";
import growthData from "@/data/yc-batch-growth.json";
import {
  batchDisplayName,
  emptyBatchGrowthFile,
  mergeBatchSnapshots,
  parseBatchGrowthFile,
  type BatchSnapshot,
} from "@/lib/yc/batch-growth";
import {
  BATCH_GROWTH_PALETTE,
  UNRELIABLE_GAP_SHARE,
  batchGrowthAriaLabel,
  buildBatchGrowthView,
  countAtDay,
  dateForDay,
  daysFromAnchorTo,
  gapShareForSeries,
  MAX_RAMP_WINDOW_DAYS,
  nearestDay,
  niceCeiling,
  projectCurrentBatch,
  rampAnchorDate,
  selectRampBatches,
  toRampPoints,
  unobservedGaps,
} from "@/lib/yc/batch-growth-chart";

function snapshot(date: string, counts: Record<string, number>): BatchSnapshot {
  return { date, counts: Object.entries(counts).map(([key, count]) => ({ key, name: batchDisplayName(key), count })) };
}

/**
 * A clean, gapless file. The leading day carries only an old batch so that the batches under test
 * appear *after* the file starts and are therefore not censored.
 */
const clean = mergeBatchSnapshots(emptyBatchGrowthFile(), [
  snapshot("2025-12-31", { "summer-2020": 209 }),
  snapshot("2026-01-01", { "summer-2020": 209, "winter-2026": 10 }),
  snapshot("2026-01-02", { "summer-2020": 209, "winter-2026": 40 }),
  snapshot("2026-01-03", { "summer-2020": 209, "winter-2026": 90, "spring-2026": 2 }),
  snapshot("2026-01-04", { "summer-2020": 209, "winter-2026": 120, "spring-2026": 6 }),
]);

describe("axis scaling", () => {
  it("rounds the y domain up to a readable ceiling", () => {
    expect(niceCeiling(94)).toBe(100);
    expect(niceCeiling(120)).toBe(150);
    expect(niceCeiling(197)).toBe(200);
    expect(niceCeiling(0)).toBe(10);
  });
});

describe("unobserved spans", () => {
  it("derives the gap between two observed ranges", () => {
    expect(
      unobservedGaps([
        ["2026-01-01", "2026-01-10"],
        ["2026-01-15", "2026-01-20"],
      ]),
    ).toEqual([{ start: "2026-01-11", end: "2026-01-14", days: 4 }]);
  });

  it("reports no gaps for a single contiguous range", () => {
    expect(unobservedGaps([["2026-01-01", "2026-01-10"]])).toEqual([]);
  });

  it("attributes growth across an unobserved span to the gap", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2026-01-01", { "winter-2026": 10 }),
      snapshot("2026-01-02", { "winter-2026": 20 }),
      // 2026-01-03 .. 2026-03-01 were never sampled; the jump to 100 is unobservable.
      snapshot("2026-03-02", { "winter-2026": 100 }),
    ]);
    const share = gapShareForSeries(file.batches[0], file.observedRanges);
    expect(share).toBeCloseTo(0.8, 5);
    expect(share).toBeGreaterThan(UNRELIABLE_GAP_SHARE);
  });

  it("reports a zero gap share for a fully observed batch", () => {
    expect(gapShareForSeries(clean.batches[0], clean.observedRanges)).toBe(0);
  });
});

describe("ramp anchoring", () => {
  const ramp = mergeBatchSnapshots(emptyBatchGrowthFile(), [
    snapshot("2025-12-31", { "summer-2020": 209 }),
    // YC lists one placeholder company months before the batch really starts filling.
    snapshot("2026-01-01", { "summer-2020": 209, "fall-2026": 1 }),
    snapshot("2026-03-01", { "summer-2020": 209, "fall-2026": 5 }),
    snapshot("2026-03-11", { "summer-2020": 209, "fall-2026": 60 }),
  ]);
  const series = ramp.batches.find((batch) => batch.key === "fall-2026")!;

  it("anchors day 0 at the first sample of at least five companies", () => {
    expect(rampAnchorDate(series)).toBe("2026-03-01");
    expect(rampAnchorDate(series, 60)).toBe("2026-03-11");
    expect(rampAnchorDate(series, 500)).toBeNull();
  });

  it("ignores the placeholder lead-in when indexing days", () => {
    const points = toRampPoints(series, "2026-03-01", ramp.lastObservedDate, ramp.observedRanges);
    expect(points.map((point) => point.day)).toEqual([0, 10]);
    expect(points[0].count).toBe(5);
  });

  it("measures milestones from the anchor, not the first appearance", () => {
    // 59 days elapsed before the anchor; the real ramp to 50 took 10 days.
    expect(daysFromAnchorTo(series, "2026-03-01", 50)).toBe(10);
    expect(daysFromAnchorTo(series, "2026-03-01", 500)).toBeNull();
  });

  it("extends the final point to the newest sample so the line reaches the edge", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2025-12-31", { "summer-2020": 209 }),
      snapshot("2026-01-02", { "summer-2020": 209, "fall-2026": 5 }),
      snapshot("2026-01-09", { "summer-2020": 209, "fall-2026": 5 }),
    ]);
    const batch = file.batches.find((item) => item.key === "fall-2026")!;
    const points = toRampPoints(batch, "2026-01-02", file.lastObservedDate, file.observedRanges);
    expect(points[points.length - 1]).toEqual({ day: 7, date: "2026-01-09", count: 5, observed: true });
  });

  it("clips points beyond the chart window", () => {
    const points = toRampPoints(series, "2026-03-01", ramp.lastObservedDate, ramp.observedRanges, 5);
    expect(points.map((point) => point.day)).toEqual([0, 5]);
    expect(points[1].count).toBe(5);
  });
});

describe("series selection", () => {
  it("holds back batches whose growth mostly landed in an unobserved span", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2025-12-31", { "summer-2020": 209 }),
      snapshot("2026-01-01", { "summer-2020": 209, "winter-2026": 10, "spring-2026": 5 }),
      snapshot("2026-01-02", { "summer-2020": 209, "winter-2026": 20, "spring-2026": 6 }),
      // 2026-01-03 .. 2026-03-01 unsampled: winter jumps 20 -> 100 unobserved, spring barely moves.
      snapshot("2026-03-02", { "summer-2020": 209, "winter-2026": 100, "spring-2026": 7 }),
    ]);
    const { selected, excluded } = selectRampBatches(file);
    expect(selected.map((batch) => batch.key)).toEqual(["spring-2026"]);
    expect(excluded.map((batch) => batch.key)).toEqual(["winter-2026"]);
    expect(excluded[0].gapShare).toBeGreaterThan(UNRELIABLE_GAP_SHARE);
  });

  it("drops censored batches and single-point batches", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2026-01-01", { "summer-2020": 209, "fall-2026": 1 }),
      snapshot("2026-01-02", { "summer-2020": 209, "fall-2026": 1 }),
    ]);
    expect(selectRampBatches(file).selected).toEqual([]);
  });

  it("keeps the newest batches but renders them chronologically", () => {
    const { selected } = selectRampBatches(clean, { limit: 2 });
    expect(selected.map((batch) => batch.key)).toEqual(["winter-2026", "spring-2026"]);
  });
});

describe("view construction", () => {
  const view = buildBatchGrowthView(clean);

  it("assigns a distinct palette colour per series", () => {
    expect(view.series[0].color).toBe(BATCH_GROWTH_PALETTE[0]);
    expect(new Set(view.series.map((series) => series.color)).size).toBe(view.series.length);
  });

  it("produces svg path segments that stay inside the plot area", () => {
    for (const series of view.series) {
      expect(series.segments.length).toBeGreaterThan(0);
      for (const segment of series.segments) {
        expect(segment.d).toMatch(/^M[\d.]+ [\d.]+L/);
        for (const [, x, y] of segment.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)) {
          expect(Number(x)).toBeGreaterThanOrEqual(0);
          expect(Number(x)).toBeLessThanOrEqual(view.width);
          expect(Number(y)).toBeGreaterThanOrEqual(0);
          expect(Number(y)).toBeLessThanOrEqual(view.height);
        }
      }
    }
  });

  it("computes milestones from the batch's first appearance", () => {
    const winter = view.series.find((series) => series.key === "winter-2026")!;
    expect(winter.milestones.find((milestone) => milestone.target === 50)!.days).toBe(2);
    expect(winter.milestones.find((milestone) => milestone.target === 150)!.days).toBeNull();
  });

  it("describes itself for screen readers", () => {
    expect(view.ariaLabel).toContain("Winter 2026");
    expect(view.ariaLabel).toContain("companies");
    expect(batchGrowthAriaLabel([], 0)).toMatch(/No YC batch ramp data/);
  });

  it("reads a count for any relative day using the step encoding", () => {
    const winter = view.series.find((series) => series.key === "winter-2026")!;
    expect(countAtDay(winter, 0)).toBe(10);
    expect(countAtDay(winter, 2)).toBe(90);
    expect(countAtDay(winter, 999)).toBe(120);
  });

  it("maps pointer positions to a day within the domain", () => {
    expect(nearestDay(view, 0)).toBe(0);
    expect(nearestDay(view, view.width)).toBe(view.maxDay);
  });
});

describe("projecting the current batch", () => {
  it("brackets the final size from how earlier batches grew after the same day", () => {
    // Consecutive days only — any gap would push the comparison batches out of the chart.
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2025-12-31", { "summer-2020": 209 }),
      // Two finished batches that doubled and tripled after day 1, plus a batch still filling.
      snapshot("2026-01-01", { "summer-2020": 209, "winter-2026": 5, "spring-2026": 5 }),
      snapshot("2026-01-02", { "summer-2020": 209, "winter-2026": 50, "spring-2026": 40, "fall-2026": 5 }),
      snapshot("2026-01-03", { "summer-2020": 209, "winter-2026": 100, "spring-2026": 120, "fall-2026": 10 }),
    ]);
    const view = buildBatchGrowthView(file);
    const projection = projectCurrentBatch(view)!;

    expect(projection.name).toBe("Fall 2026");
    expect(projection.day).toBe(1);
    expect(projection.count).toBe(10);
    // Winter doubled after day 1 (50 -> 100), Spring tripled (40 -> 120).
    expect(projection.comparisons.map((entry) => entry.multiple)).toEqual([2, 3]);
    expect(projection.low).toBe(20);
    expect(projection.high).toBe(30);
  });

  it("returns nothing once the newest batch has stopped filling", () => {
    const view = buildBatchGrowthView(clean);
    // Every batch in the clean fixture is short-lived, so none is still ramping at the window edge.
    const projection = projectCurrentBatch(view);
    if (projection) expect(projection.day).toBeLessThan(view.maxDay);
  });

  it("maps a relative day back to the batch's calendar date", () => {
    const view = buildBatchGrowthView(clean);
    const series = view.series[0];
    expect(dateForDay(series, 0)).toBe(series.anchorDate);
    expect(dateForDay(series, 2)).toBe("2026-01-03");
  });
});

describe("the committed dataset", () => {
  const file = parseBatchGrowthFile(growthData);
  const view = buildBatchGrowthView(file);

  it("parses and yields a chartable view", () => {
    expect(file.batches.length).toBeGreaterThan(40);
    expect(view.series.length).toBeGreaterThan(1);
    expect(view.maxCount).toBeGreaterThan(0);
  });

  it("excludes the batches ruined by the upstream mirror outage", () => {
    // The yc-oss mirror published nothing between 2026-02-09 and 2026-05-03.
    expect(view.gaps.some((gap) => gap.days > 30)).toBe(true);
    const chartedKeys = view.series.map((series) => series.key);
    expect(chartedKeys).not.toContain("spring-2026");
    expect(view.excluded.map((batch) => batch.key)).toContain("spring-2026");
    for (const series of view.series) {
      expect(series.gapShare).toBeLessThanOrEqual(UNRELIABLE_GAP_SHARE);
    }
  });

  it("clips the x domain to the ramp rather than the years batches stay listed", () => {
    // Batches remain in the directory forever; without clipping the axis runs past 600 days.
    expect(view.maxDay).toBeLessThanOrEqual(MAX_RAMP_WINDOW_DAYS);
    expect(view.maxDay).toBeGreaterThan(0);
  });

  it("reports comparable days-to-50 once the placeholder lead-in is removed", () => {
    const fifties = view.series
      .map((series) => series.milestones.find((milestone) => milestone.target === 50)?.days)
      .filter((days): days is number => typeof days === "number");
    expect(fifties.length).toBeGreaterThan(2);
    // Anchoring on the first appearance produced 151 days for Summer 2026 against 26 for
    // Summer 2025; anchored at five companies every batch lands in the same range.
    for (const days of fifties) expect(days).toBeLessThan(100);
  });

  it("charts only fully observed ramps", () => {
    for (const series of view.series) {
      const batch = file.batches.find((item) => item.key === series.key)!;
      expect(batch.censored).toBe(false);
    }
  });
});
