import {
  addUtcDays,
  compareBatchKeys,
  daysBetween,
  type BatchGrowthFile,
  type BatchGrowthSeries,
  type DateRange,
} from "@/lib/yc/batch-growth";

export const BATCH_GROWTH_WIDTH = 900;
export const BATCH_GROWTH_HEIGHT = 380;
export const BATCH_GROWTH_PADDING = { top: 18, right: 22, bottom: 38, left: 46 } as const;

/** Newsprint tokens from globals.css, extended with the muted variants used by the signal map. */
export const BATCH_GROWTH_PALETTE = [
  "#d85b35",
  "#5478a8",
  "#315f49",
  "#806b9f",
  "#b88b3c",
  "#3d827f",
  "#846654",
  "#9b5b75",
] as const;

/** Above this share of growth lost to unobserved days, a ramp curve is not worth charting. */
export const UNRELIABLE_GAP_SHARE = 0.2;
export const DEFAULT_SERIES_LIMIT = 6;
export const MILESTONES = [50, 100, 150] as const;

/**
 * Day 0 is the first day a batch had at least this many companies. YC lists one or two placeholder
 * companies months before a batch actually starts filling — anchoring on the true first appearance
 * makes Summer 2026 look like it took 151 days to reach 50 companies when the real ramp took 36.
 */
export const RAMP_ANCHOR_COUNT = 5;
/** The x domain is clipped to where the charted batches finish, within these bounds. */
export const MIN_RAMP_WINDOW_DAYS = 60;
export const MAX_RAMP_WINDOW_DAYS = 180;
const RAMP_COMPLETE_SHARE = 0.95;

export type RampPoint = { day: number; date: string; count: number; observed: boolean };

export type BatchRampSeries = {
  key: string;
  name: string;
  color: string;
  latestCount: number;
  firstObservedDate: string;
  /** The day-0 date: first sample at or above `RAMP_ANCHOR_COUNT` companies. */
  anchorDate: string;
  /** Days from the anchor to the newest sample, clipped to the chart window. */
  spanDays: number;
  /** Share of total growth that landed on days the mirror never sampled. */
  gapShare: number;
  points: RampPoint[];
  /** Path `d` strings split so unobserved spans can be drawn as a dashed connector. */
  segments: { d: string; observed: boolean }[];
  milestones: { target: number; days: number | null }[];
};

export type BatchGrowthView = {
  width: number;
  height: number;
  series: BatchRampSeries[];
  maxDay: number;
  maxCount: number;
  xTicks: { value: number; x: number; label: string }[];
  yTicks: { value: number; y: number; label: string }[];
  lastObservedDate: string;
  /** Unobserved spans expressed in whole days, for the explainer copy. */
  gaps: { start: string; end: string; days: number }[];
  /** Uncensored batches held back because too much of their growth is unobservable. */
  excluded: { key: string; name: string; gapShare: number }[];
  ariaLabel: string;
};

function isObserved(ranges: readonly DateRange[], date: string) {
  return ranges.some(([start, end]) => date >= start && date <= end);
}

export function unobservedGaps(ranges: readonly DateRange[]) {
  const gaps: { start: string; end: string; days: number }[] = [];
  for (let index = 1; index < ranges.length; index += 1) {
    const start = addUtcDays(ranges[index - 1][1], 1);
    const end = addUtcDays(ranges[index][0], -1);
    gaps.push({ start, end, days: daysBetween(start, end) + 1 });
  }
  return gaps;
}

/**
 * Growth that landed on a day the mirror never sampled. The mirror went dark for 84 days in early
 * 2026, which makes a couple of batch ramps meaningless — they must not sit in the default view
 * looking like a real measurement.
 */
export function gapShareForSeries(series: BatchGrowthSeries, ranges: readonly DateRange[]) {
  let unobserved = 0;
  let previous: number | null = null;
  for (const [date, count] of series.points) {
    if (previous !== null && !isObserved(ranges, addUtcDays(date, -1))) {
      unobserved += Math.max(0, count - previous);
    }
    previous = count;
  }
  const total = series.points[series.points.length - 1]?.[1] ?? 0;
  return total > 0 ? unobserved / total : 0;
}

export function niceCeiling(value: number) {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return Math.round(candidate);
  }
  return Math.round(10 * magnitude);
}

/** The day-0 date for a ramp: the first sample at or above `RAMP_ANCHOR_COUNT` companies. */
export function rampAnchorDate(series: BatchGrowthSeries, anchorCount: number = RAMP_ANCHOR_COUNT) {
  return series.points.find(([, count]) => count >= anchorCount)?.[0] ?? null;
}

/** Days from the anchor until the batch first reached `target`. */
export function daysFromAnchorTo(series: BatchGrowthSeries, anchorDate: string, target: number) {
  const match = series.points.find(([, count]) => count >= target);
  return match ? Math.max(0, daysBetween(anchorDate, match[0])) : null;
}

/**
 * Expands the sparse step encoding into one point per change, indexed from the anchor, plus a final
 * point so the line reaches the newest sample (or the clipped window edge) instead of stopping at
 * the last change.
 */
export function toRampPoints(
  series: BatchGrowthSeries,
  anchorDate: string,
  lastObservedDate: string,
  ranges: readonly DateRange[],
  maxDay = Number.POSITIVE_INFINITY,
): RampPoint[] {
  const points: RampPoint[] = [];
  let carried: RampPoint | null = null;

  for (const [date, count] of series.points) {
    if (date < anchorDate) continue;
    const day = daysBetween(anchorDate, date);
    const point = {
      day,
      date,
      count,
      observed: isObserved(ranges, addUtcDays(date, -1)) || date === series.firstObservedDate,
    };
    if (day > maxDay) break;
    points.push(point);
    carried = point;
  }

  const endDay = Math.min(daysBetween(anchorDate, lastObservedDate), maxDay);
  if (carried && carried.day < endDay) {
    points.push({ day: endDay, date: addUtcDays(anchorDate, endDay), count: carried.count, observed: true });
  }
  return points;
}

/** Recent, uncensored, reliably-observed batches — newest first, capped at `limit`. */
export function selectRampBatches(file: BatchGrowthFile, options: { limit?: number } = {}) {
  const candidates = file.batches.filter((batch) => !batch.censored && batch.points.length >= 2);
  const reliable = candidates.filter((batch) => gapShareForSeries(batch, file.observedRanges) <= UNRELIABLE_GAP_SHARE);
  const excluded = candidates
    .filter((batch) => !reliable.includes(batch))
    .sort((left, right) => compareBatchKeys(right, left))
    .map((batch) => ({ key: batch.key, name: batch.name, gapShare: gapShareForSeries(batch, file.observedRanges) }));

  return {
    selected: reliable
      .sort((left, right) => compareBatchKeys(right, left))
      .slice(0, options.limit ?? DEFAULT_SERIES_LIMIT)
      .sort(compareBatchKeys),
    excluded,
  };
}

export function buildBatchGrowthView(file: BatchGrowthFile, options: { limit?: number } = {}): BatchGrowthView {
  const { selected: candidates, excluded } = selectRampBatches(file, options);
  const ranges = file.observedRanges;
  const lastObservedDate = file.lastObservedDate;

  const anchored = candidates
    .map((batch) => ({ batch, anchorDate: rampAnchorDate(batch) }))
    .filter((entry): entry is { batch: BatchGrowthSeries; anchorDate: string } => entry.anchorDate !== null);

  // Clip the x domain to where the charted batches actually finish filling. Batches stay listed
  // for years after they close, and a 600-day axis squeezes every real ramp into the left edge.
  const completionDays = anchored.map(({ batch, anchorDate }) => {
    const target = Math.ceil(batch.latestCount * RAMP_COMPLETE_SHARE);
    return daysFromAnchorTo(batch, anchorDate, target) ?? MIN_RAMP_WINDOW_DAYS;
  });
  const maxDay = Math.min(
    MAX_RAMP_WINDOW_DAYS,
    Math.max(MIN_RAMP_WINDOW_DAYS, ...completionDays),
  );

  // A batch that only just crossed the anchor has a single point and therefore no line to draw.
  const charted = anchored
    .map((entry) => ({ ...entry, points: toRampPoints(entry.batch, entry.anchorDate, lastObservedDate, ranges, maxDay) }))
    .filter((entry) => entry.points.length >= 2);
  const selected = charted.map((entry) => entry.batch);
  const rampPoints = charted.map((entry) => entry.points);
  const maxCount = niceCeiling(Math.max(1, ...rampPoints.flatMap((points) => points.map((point) => point.count))));

  const plotWidth = BATCH_GROWTH_WIDTH - BATCH_GROWTH_PADDING.left - BATCH_GROWTH_PADDING.right;
  const plotHeight = BATCH_GROWTH_HEIGHT - BATCH_GROWTH_PADDING.top - BATCH_GROWTH_PADDING.bottom;
  const toX = (day: number) => BATCH_GROWTH_PADDING.left + (day / maxDay) * plotWidth;
  const toY = (count: number) => BATCH_GROWTH_PADDING.top + plotHeight - (count / maxCount) * plotHeight;
  const round = (value: number) => Math.round(value * 10) / 10;

  const series = selected.map((batch, index) => {
    const points = rampPoints[index];
    const segments: { d: string; observed: boolean }[] = [];
    for (let cursor = 1; cursor < points.length; cursor += 1) {
      const from = points[cursor - 1];
      const to = points[cursor];
      const d = `M${round(toX(from.day))} ${round(toY(from.count))}L${round(toX(to.day))} ${round(toY(to.count))}`;
      const previous = segments[segments.length - 1];
      if (previous && previous.observed === to.observed) {
        previous.d += d.slice(d.indexOf("L"));
        continue;
      }
      segments.push({ d, observed: to.observed });
    }

    const anchorDate = charted[index].anchorDate;
    return {
      key: batch.key,
      name: batch.name,
      color: BATCH_GROWTH_PALETTE[index % BATCH_GROWTH_PALETTE.length],
      latestCount: batch.latestCount,
      firstObservedDate: batch.firstObservedDate,
      anchorDate,
      spanDays: points[points.length - 1]?.day ?? 0,
      gapShare: gapShareForSeries(batch, ranges),
      points,
      segments,
      milestones: MILESTONES.map((target) => ({ target, days: daysFromAnchorTo(batch, anchorDate, target) })),
    } satisfies BatchRampSeries;
  });

  const xTickStep = maxDay <= 60 ? 15 : maxDay <= 120 ? 20 : 30;
  const xTicks = [];
  for (let value = 0; value <= maxDay; value += xTickStep) {
    xTicks.push({ value, x: round(toX(value)), label: String(value) });
  }
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const value = Math.round(maxCount * fraction);
    return { value, y: round(toY(value)), label: String(value) };
  });

  return {
    width: BATCH_GROWTH_WIDTH,
    height: BATCH_GROWTH_HEIGHT,
    series,
    maxDay,
    maxCount,
    xTicks,
    yTicks,
    lastObservedDate,
    gaps: unobservedGaps(ranges),
    excluded,
    ariaLabel: batchGrowthAriaLabel(series, maxDay),
  };
}

export function batchGrowthAriaLabel(series: readonly BatchRampSeries[], maxDay: number) {
  if (series.length === 0) return "No YC batch ramp data is available yet.";
  const described = series
    .map((item) => {
      const fifty = item.milestones.find((milestone) => milestone.target === 50)?.days;
      return `${item.name} now lists ${item.latestCount} companies${
        fifty === null || fifty === undefined ? "" : ` and reached 50 in ${fifty} days`
      }`;
    })
    .join("; ");
  return `Cumulative company count for ${series.length} YC batches over the ${maxDay} days after each batch first reached ${RAMP_ANCHOR_COUNT} companies. ${described}.`;
}

/** Nearest day index for a pointer position already converted into viewBox coordinates. */
export function nearestDay(view: BatchGrowthView, x: number) {
  const plotWidth = view.width - BATCH_GROWTH_PADDING.left - BATCH_GROWTH_PADDING.right;
  const ratio = (x - BATCH_GROWTH_PADDING.left) / plotWidth;
  return Math.max(0, Math.min(view.maxDay, Math.round(ratio * view.maxDay)));
}

export function dayToX(view: BatchGrowthView, day: number) {
  const plotWidth = view.width - BATCH_GROWTH_PADDING.left - BATCH_GROWTH_PADDING.right;
  return BATCH_GROWTH_PADDING.left + (day / view.maxDay) * plotWidth;
}

export function countToY(view: BatchGrowthView, count: number) {
  const plotHeight = view.height - BATCH_GROWTH_PADDING.top - BATCH_GROWTH_PADDING.bottom;
  return BATCH_GROWTH_PADDING.top + plotHeight - (count / view.maxCount) * plotHeight;
}

/** Count for a series on a given relative day, honouring the step encoding. */
export function countAtDay(series: BatchRampSeries, day: number) {
  let count: number | null = null;
  for (const point of series.points) {
    if (point.day > day) break;
    count = point.count;
  }
  return count;
}

/** The calendar date a relative day maps to for a given batch. */
export function dateForDay(series: BatchRampSeries, day: number) {
  return addUtcDays(series.anchorDate, day);
}

export type BatchProjection = {
  name: string;
  day: number;
  count: number;
  comparisons: { name: string; atSameDay: number; final: number; multiple: number }[];
  low: number;
  median: number;
  high: number;
};

/**
 * How much bigger earlier batches got after the point the newest batch has reached. Each completed
 * batch gives a multiple (final ÷ count at the same day); applying those to today's count brackets
 * how many more companies to expect. Returns null once the newest batch has stopped filling.
 */
export function projectCurrentBatch(view: BatchGrowthView): BatchProjection | null {
  const current = view.series[view.series.length - 1];
  if (!current || current.spanDays >= view.maxDay) return null;

  const day = current.spanDays;
  const count = countAtDay(current, day);
  if (count === null || count <= 0) return null;

  const comparisons = view.series
    .slice(0, -1)
    .map((series) => {
      const atSameDay = countAtDay(series, day);
      if (atSameDay === null || atSameDay <= 0) return null;
      return { name: series.name, atSameDay, final: series.latestCount, multiple: series.latestCount / atSameDay };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (comparisons.length < 2) return null;

  const multiples = comparisons.map((entry) => entry.multiple).sort((left, right) => left - right);
  return {
    name: current.name,
    day,
    count,
    comparisons,
    low: Math.round(count * multiples[0]),
    median: Math.round(count * multiples[Math.floor(multiples.length / 2)]),
    high: Math.round(count * multiples[multiples.length - 1]),
  };
}
