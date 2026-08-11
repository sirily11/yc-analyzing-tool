export const BATCH_GROWTH_SOURCE_URL = "https://yc-oss.github.io/api/meta.json";
export const BATCH_CHANGES_BASE_URL = "https://yc-oss.github.io/api/changes/";
export const YC_OSS_REPO = "yc-oss/api";
export const YC_COMPANY_BASE_URL = "https://www.ycombinator.com/companies/";

/** The first day `changes/<date>.json` exists upstream. Earlier dates always 404. */
export const BATCH_CHANGES_FIRST_DATE = "2026-06-30";
export const BATCH_ADDITIONS_WINDOW_DAYS = 90;
export const BATCH_ADDITIONS_MAX_ENTRIES = 400;

export type BatchSeason = "winter" | "spring" | "summer" | "fall";

/** `[date, count]` — an absolute UTC date, not a day index. */
export type BatchGrowthPoint = readonly [date: string, count: number];

export type BatchGrowthSeries = {
  key: string;
  name: string;
  season: BatchSeason;
  year: number;
  firstObservedDate: string;
  latestCount: number;
  /** True when the batch already existed on the first sampled day, so its ramp is unknowable. */
  censored: boolean;
  points: BatchGrowthPoint[];
};

/** Inclusive `[start, end]` pair of UTC dates that were actually sampled. */
export type DateRange = readonly [start: string, end: string];

export type BatchGrowthFile = {
  version: 1;
  source: string;
  firstObservedDate: string;
  lastObservedDate: string;
  observedRanges: DateRange[];
  batches: BatchGrowthSeries[];
};

export type BatchSnapshot = {
  date: string;
  counts: { key: string; name: string; count: number }[];
};

export type BatchAdditionCompany = {
  id: number;
  name: string;
  slug: string;
  batch: string;
  batchKey: string | null;
  oneLiner: string;
  industry: string;
  location: string;
  teamSize: number | null;
  status: string;
  website: string | null;
  logo: string | null;
  url: string;
  addedOn: string;
};

export type BatchAdditionDay = {
  date: string;
  added: number;
  removed: number;
  updated: number;
  total: number;
};

export type BatchAdditionsFile = {
  version: 1;
  source: string;
  windowDays: number;
  maxEntries: number;
  firstDate: string;
  lastDate: string;
  days: BatchAdditionDay[];
  companies: BatchAdditionCompany[];
};

const SEASON_ORDER: Record<BatchSeason, number> = { winter: 0, spring: 1, summer: 2, fall: 3 };

/**
 * Upstream renamed its batch keys in ~May 2025: short codes (`w24`, `s24`, `f24`, `x25`) became
 * long form (`winter-2024`). Both must collapse to one canonical key or every batch that spans the
 * rename appears twice with a broken curve.
 */
const SHORT_SEASON_CODES: Record<string, BatchSeason> = {
  w: "winter",
  x: "spring",
  s: "summer",
  f: "fall",
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function optionalText(value: unknown) {
  return text(value) || null;
}

function wholeNumber(value: unknown) {
  if (typeof value !== "number") {
    // `Number("")` is 0, so an absent field would otherwise read as a real zero count.
    const raw = text(value);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertIsoDate(value: unknown, label: string): string {
  if (!isIsoDate(value)) throw new Error(`${label} must be a YYYY-MM-DD UTC date, received ${JSON.stringify(value)}.`);
  return value;
}

export function toUtcDate(value: string) {
  return new Date(`${assertIsoDate(value, "Date")}T00:00:00.000Z`);
}

export function addUtcDays(value: string, days: number) {
  const shifted = new Date(toUtcDate(value).getTime() + days * 86400000);
  return shifted.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86400000);
}

/**
 * Accepts every historical spelling: `winter-2025`, `Winter 2025`, `w25`, `W25`.
 * Returns null for `unspecified`, `ik12`, and anything unparseable — those are dropped, not stored.
 */
export function parseBatchKey(value: string): { key: string; season: BatchSeason; year: number } | null {
  const normalized = text(value).toLowerCase().replace(/[\s_]+/g, "-");
  if (!normalized) return null;

  const long = normalized.match(/^(winter|spring|summer|fall)-(\d{4})$/);
  if (long) {
    const season = long[1] as BatchSeason;
    const year = Number(long[2]);
    return year >= 2005 && year <= 2100 ? { key: `${season}-${year}`, season, year } : null;
  }

  const short = normalized.match(/^([wxsf])(\d{2})$/);
  if (short) {
    const season = SHORT_SEASON_CODES[short[1]];
    const year = 2000 + Number(short[2]);
    return { key: `${season}-${year}`, season, year };
  }

  return null;
}

export function batchDisplayName(key: string) {
  const parsed = parseBatchKey(key);
  if (!parsed) return key;
  return `${parsed.season.charAt(0).toUpperCase()}${parsed.season.slice(1)} ${parsed.year}`;
}

export function compareBatchKeys(left: { season: BatchSeason; year: number }, right: { season: BatchSeason; year: number }) {
  return left.year - right.year || SEASON_ORDER[left.season] - SEASON_ORDER[right.season];
}

/** Reads one historical `meta.json` blob into a snapshot, dropping `unspecified` and legacy keys. */
export function parseBatchMeta(raw: unknown, date: string): BatchSnapshot {
  assertIsoDate(date, "Snapshot date");
  if (!raw || typeof raw !== "object") throw new Error(`meta.json for ${date} is not an object.`);
  const batches = (raw as { batches?: unknown }).batches;
  if (!batches || typeof batches !== "object" || Array.isArray(batches)) {
    throw new Error(`meta.json for ${date} is missing a "batches" object.`);
  }

  const counts = new Map<string, { key: string; name: string; count: number }>();
  for (const [rawKey, rawValue] of Object.entries(batches as Record<string, unknown>)) {
    const parsed = parseBatchKey(rawKey);
    if (!parsed) continue;
    if (!rawValue || typeof rawValue !== "object") continue;
    const count = wholeNumber((rawValue as { count?: unknown }).count);
    if (count === null) continue;
    // A canonical key can only be produced once per snapshot; keep the larger count if upstream
    // ever emits both spellings during a rename window.
    const existing = counts.get(parsed.key);
    if (existing && existing.count >= count) continue;
    counts.set(parsed.key, { key: parsed.key, name: batchDisplayName(parsed.key), count });
  }

  return {
    date,
    counts: [...counts.values()].sort((left, right) =>
      compareBatchKeys(parseBatchKey(left.key)!, parseBatchKey(right.key)!)
    ),
  };
}

export function emptyBatchGrowthFile(): BatchGrowthFile {
  return {
    version: 1,
    source: BATCH_GROWTH_SOURCE_URL,
    firstObservedDate: "",
    lastObservedDate: "",
    observedRanges: [],
    batches: [],
  };
}

/**
 * Sorts by date, keeps the last value for a duplicated date, and drops any point whose count equals
 * its predecessor's. Running this after every insert is what makes the merge order-independent.
 */
export function compactSeries(points: readonly BatchGrowthPoint[]): BatchGrowthPoint[] {
  const byDate = new Map<string, number>();
  for (const [date, count] of points) byDate.set(assertIsoDate(date, "Point date"), count);

  const sorted = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right));
  const compacted: BatchGrowthPoint[] = [];
  for (const [date, count] of sorted) {
    const previous = compacted[compacted.length - 1];
    if (previous && previous[1] === count) continue;
    compacted.push([date, count]);
  }
  return compacted;
}

export function insertObservedDate(ranges: readonly DateRange[], date: string): DateRange[] {
  assertIsoDate(date, "Observed date");
  if (ranges.some(([start, end]) => date >= start && date <= end)) return ranges.map((range) => [...range] as DateRange);

  const merged: DateRange[] = [...ranges.map((range) => [...range] as DateRange), [date, date]];
  merged.sort(([left], [right]) => left.localeCompare(right));

  const result: DateRange[] = [];
  for (const range of merged) {
    const previous = result[result.length - 1];
    // Adjacent ranges (end + 1 day === next start) collapse into one.
    if (previous && range[0] <= addUtcDays(previous[1], 1)) {
      result[result.length - 1] = [previous[0], previous[1] >= range[1] ? previous[1] : range[1]];
      continue;
    }
    result.push(range);
  }
  return result;
}

export function isDateObserved(ranges: readonly DateRange[], date: string) {
  return ranges.some(([start, end]) => date >= start && date <= end);
}

export function missingObservedDates(ranges: readonly DateRange[], candidates: readonly string[]) {
  const missing = new Set<string>();
  for (const candidate of candidates) {
    if (!isIsoDate(candidate)) continue;
    if (!isDateObserved(ranges, candidate)) missing.add(candidate);
  }
  return [...missing].sort((left, right) => left.localeCompare(right));
}

/**
 * Merges snapshots in any order. Backfill inserts older dates after newer ones already exist, so
 * this must never assume the incoming dates are the newest.
 */
export function mergeBatchSnapshots(file: BatchGrowthFile, snapshots: readonly BatchSnapshot[]): BatchGrowthFile {
  const series = new Map<string, BatchGrowthSeries>();
  for (const batch of file.batches) {
    series.set(batch.key, { ...batch, points: [...batch.points] });
  }
  let observedRanges = file.observedRanges.map((range) => [...range] as DateRange);

  for (const snapshot of [...snapshots].sort((left, right) => left.date.localeCompare(right.date))) {
    observedRanges = insertObservedDate(observedRanges, snapshot.date);
    for (const entry of snapshot.counts) {
      const parsed = parseBatchKey(entry.key);
      if (!parsed) continue;
      const existing = series.get(parsed.key);
      if (existing) {
        existing.points.push([snapshot.date, entry.count]);
        continue;
      }
      series.set(parsed.key, {
        key: parsed.key,
        name: entry.name || batchDisplayName(parsed.key),
        season: parsed.season,
        year: parsed.year,
        firstObservedDate: snapshot.date,
        latestCount: entry.count,
        censored: false,
        points: [[snapshot.date, entry.count]],
      });
    }
  }

  const firstObservedDate = observedRanges[0]?.[0] ?? "";
  const lastObservedDate = observedRanges[observedRanges.length - 1]?.[1] ?? "";

  const batches = [...series.values()]
    .map((batch) => {
      const points = compactSeries(batch.points);
      const firstPointDate = points[0]?.[0] ?? batch.firstObservedDate;
      return {
        ...batch,
        points,
        firstObservedDate: firstPointDate,
        latestCount: points[points.length - 1]?.[1] ?? 0,
        censored: Boolean(firstObservedDate) && firstPointDate === firstObservedDate,
      };
    })
    .sort(compareBatchKeys);

  return { version: 1, source: file.source || BATCH_GROWTH_SOURCE_URL, firstObservedDate, lastObservedDate, observedRanges, batches };
}

export function parseBatchGrowthFile(raw: unknown): BatchGrowthFile {
  if (!raw || typeof raw !== "object") throw new Error("Batch growth file must be an object.");
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) throw new Error(`Unsupported batch growth file version: ${String(record.version)}.`);
  if (!Array.isArray(record.batches)) throw new Error("Batch growth file is missing a batches array.");
  if (!Array.isArray(record.observedRanges)) throw new Error("Batch growth file is missing an observedRanges array.");

  const observedRanges = record.observedRanges.map((range) => {
    if (!Array.isArray(range) || range.length !== 2) throw new Error("Each observed range must be a [start, end] pair.");
    return [assertIsoDate(range[0], "Range start"), assertIsoDate(range[1], "Range end")] as DateRange;
  });

  const batches = record.batches.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Each batch must be an object.");
    const batch = value as Record<string, unknown>;
    const parsed = parseBatchKey(text(batch.key));
    if (!parsed) throw new Error(`Unparseable batch key: ${JSON.stringify(batch.key)}.`);
    if (!Array.isArray(batch.points)) throw new Error(`Batch ${parsed.key} is missing a points array.`);
    const points = batch.points.map((point) => {
      if (!Array.isArray(point) || point.length !== 2) throw new Error(`Batch ${parsed.key} has a malformed point tuple.`);
      const count = wholeNumber(point[1]);
      if (count === null) throw new Error(`Batch ${parsed.key} has a non-numeric count.`);
      return [assertIsoDate(point[0], `Batch ${parsed.key} point date`), count] as BatchGrowthPoint;
    });
    return {
      key: parsed.key,
      name: text(batch.name) || batchDisplayName(parsed.key),
      season: parsed.season,
      year: parsed.year,
      firstObservedDate: points[0]?.[0] ?? "",
      latestCount: points[points.length - 1]?.[1] ?? 0,
      censored: batch.censored === true,
      points,
    } satisfies BatchGrowthSeries;
  });

  return {
    version: 1,
    source: text(record.source) || BATCH_GROWTH_SOURCE_URL,
    firstObservedDate: text(record.firstObservedDate),
    lastObservedDate: text(record.lastObservedDate),
    observedRanges,
    batches: batches.sort(compareBatchKeys),
  };
}

export function emptyBatchAdditionsFile(): BatchAdditionsFile {
  return {
    version: 1,
    source: BATCH_CHANGES_BASE_URL,
    windowDays: BATCH_ADDITIONS_WINDOW_DAYS,
    maxEntries: BATCH_ADDITIONS_MAX_ENTRIES,
    firstDate: "",
    lastDate: "",
    days: [],
    companies: [],
  };
}

export function normalizeAddedCompany(raw: unknown, addedOn: string): BatchAdditionCompany | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = wholeNumber(record.id);
  const name = text(record.name);
  const slug = text(record.slug);
  if (id === null || id === 0 || !name || !slug) return null;

  const batch = text(record.batch);
  return {
    id,
    name,
    slug,
    batch,
    batchKey: parseBatchKey(batch)?.key ?? null,
    oneLiner: text(record.one_liner),
    industry: text(record.industry),
    location: text(record.all_locations),
    teamSize: wholeNumber(record.team_size),
    status: text(record.status),
    website: optionalText(record.website),
    logo: optionalText(record.small_logo_thumb_url),
    url: text(record.url) || `${YC_COMPANY_BASE_URL}${slug}`,
    addedOn: assertIsoDate(addedOn, "Addition date"),
  };
}

export function parseChangesPayload(raw: unknown, date: string): { day: BatchAdditionDay; companies: BatchAdditionCompany[] } {
  assertIsoDate(date, "Changes date");
  if (!raw || typeof raw !== "object") throw new Error(`changes/${date}.json is not an object.`);
  const record = raw as Record<string, unknown>;
  const summary = (record.summary ?? {}) as Record<string, unknown>;
  const added = Array.isArray(record.added) ? record.added : [];

  return {
    day: {
      date,
      added: wholeNumber(summary.added) ?? added.length,
      removed: wholeNumber(summary.removed) ?? 0,
      updated: wholeNumber(summary.updated) ?? 0,
      total: wholeNumber(summary.current_total) ?? 0,
    },
    companies: added
      .map((entry) => normalizeAddedCompany(entry, date))
      .filter((entry): entry is BatchAdditionCompany => entry !== null),
  };
}

export function mergeAdditionSnapshots(
  file: BatchAdditionsFile,
  snapshots: readonly { day: BatchAdditionDay; companies: BatchAdditionCompany[] }[],
  options: { today: string; windowDays?: number; maxEntries?: number },
): BatchAdditionsFile {
  const windowDays = options.windowDays ?? file.windowDays ?? BATCH_ADDITIONS_WINDOW_DAYS;
  const maxEntries = options.maxEntries ?? file.maxEntries ?? BATCH_ADDITIONS_MAX_ENTRIES;
  const cutoff = addUtcDays(assertIsoDate(options.today, "Today"), -windowDays);

  const days = new Map<string, BatchAdditionDay>();
  for (const day of file.days) days.set(day.date, day);
  const companies = new Map<number, BatchAdditionCompany>();
  for (const company of file.companies) companies.set(company.id, company);

  for (const snapshot of snapshots) {
    days.set(snapshot.day.date, snapshot.day);
    for (const company of snapshot.companies) {
      const existing = companies.get(company.id);
      // Keep the newest sighting so a re-added company does not resurface with a stale date.
      if (existing && existing.addedOn >= company.addedOn) continue;
      companies.set(company.id, company);
    }
  }

  const keptDays = [...days.values()]
    .filter((day) => day.date >= cutoff)
    .sort((left, right) => right.date.localeCompare(left.date));
  const keptCompanies = [...companies.values()]
    .filter((company) => company.addedOn >= cutoff)
    .sort((left, right) => right.addedOn.localeCompare(left.addedOn) || left.name.localeCompare(right.name))
    .slice(0, maxEntries);

  return {
    version: 1,
    source: file.source || BATCH_CHANGES_BASE_URL,
    windowDays,
    maxEntries,
    firstDate: keptDays[keptDays.length - 1]?.date ?? "",
    lastDate: keptDays[0]?.date ?? "",
    days: keptDays,
    companies: keptCompanies,
  };
}

export function parseBatchAdditionsFile(raw: unknown): BatchAdditionsFile {
  if (!raw || typeof raw !== "object") throw new Error("Batch additions file must be an object.");
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) throw new Error(`Unsupported batch additions file version: ${String(record.version)}.`);
  if (!Array.isArray(record.days) || !Array.isArray(record.companies)) {
    throw new Error("Batch additions file is missing days or companies.");
  }

  const days = record.days.map((value) => {
    const day = (value ?? {}) as Record<string, unknown>;
    return {
      date: assertIsoDate(day.date, "Addition day date"),
      added: wholeNumber(day.added) ?? 0,
      removed: wholeNumber(day.removed) ?? 0,
      updated: wholeNumber(day.updated) ?? 0,
      total: wholeNumber(day.total) ?? 0,
    } satisfies BatchAdditionDay;
  });

  const companies = record.companies
    .map((value) => {
      const company = (value ?? {}) as Record<string, unknown>;
      const addedOn = text(company.addedOn);
      return isIsoDate(addedOn) ? normalizeAddedCompanyFromStored(company, addedOn) : null;
    })
    .filter((company): company is BatchAdditionCompany => company !== null);

  return {
    version: 1,
    source: text(record.source) || BATCH_CHANGES_BASE_URL,
    windowDays: wholeNumber(record.windowDays) ?? BATCH_ADDITIONS_WINDOW_DAYS,
    maxEntries: wholeNumber(record.maxEntries) ?? BATCH_ADDITIONS_MAX_ENTRIES,
    firstDate: text(record.firstDate),
    lastDate: text(record.lastDate),
    days,
    companies,
  };
}

/** Stored records already use our field names, unlike the upstream `changes` payload. */
function normalizeAddedCompanyFromStored(record: Record<string, unknown>, addedOn: string): BatchAdditionCompany | null {
  const id = wholeNumber(record.id);
  const name = text(record.name);
  const slug = text(record.slug);
  if (id === null || id === 0 || !name || !slug) return null;
  const batch = text(record.batch);
  return {
    id,
    name,
    slug,
    batch,
    batchKey: parseBatchKey(batch)?.key ?? null,
    oneLiner: text(record.oneLiner),
    industry: text(record.industry),
    location: text(record.location),
    teamSize: wholeNumber(record.teamSize),
    status: text(record.status),
    website: optionalText(record.website),
    logo: optionalText(record.logo),
    url: text(record.url) || `${YC_COMPANY_BASE_URL}${slug}`,
    addedOn,
  };
}

/** Newest commit per UTC date, ascending. Upstream pushes once a day, but never assume it. */
export function lastCommitPerDate(commits: readonly { sha: string; date: string }[]) {
  const byDate = new Map<string, { date: string; sha: string; timestamp: string }>();
  for (const commit of commits) {
    const date = commit.date.slice(0, 10);
    if (!isIsoDate(date)) continue;
    const existing = byDate.get(date);
    if (existing && existing.timestamp >= commit.date) continue;
    byDate.set(date, { date, sha: commit.sha, timestamp: commit.date });
  }
  return [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(({ date, sha }) => ({ date, sha }));
}

/**
 * Pretty outer wrapper, one compact line per array element. A day where a single batch moved
 * produces a one-line diff, and an unchanged upstream produces a zero-byte diff.
 */
function formatWithCompactRows(wrapper: Record<string, unknown>, rowKeys: readonly string[]) {
  const entries = Object.entries(wrapper).map(([key, value]) => {
    if (rowKeys.includes(key) && Array.isArray(value)) {
      if (value.length === 0) return `  ${JSON.stringify(key)}: []`;
      const rows = value.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
      return `  ${JSON.stringify(key)}: [\n${rows}\n  ]`;
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  });
  return `{\n${entries.join(",\n")}\n}\n`;
}

export function formatBatchGrowthJson(file: BatchGrowthFile) {
  return formatWithCompactRows(
    {
      version: file.version,
      source: file.source,
      firstObservedDate: file.firstObservedDate,
      lastObservedDate: file.lastObservedDate,
      observedRanges: file.observedRanges,
      batches: file.batches,
    },
    ["observedRanges", "batches"],
  );
}

export function formatBatchAdditionsJson(file: BatchAdditionsFile) {
  return formatWithCompactRows(
    {
      version: file.version,
      source: file.source,
      windowDays: file.windowDays,
      maxEntries: file.maxEntries,
      firstDate: file.firstDate,
      lastDate: file.lastDate,
      days: file.days,
      companies: file.companies,
    },
    ["days", "companies"],
  );
}

/** Count on a given date, honouring the sparse step encoding. Null before the batch appeared. */
export function countOnDate(series: BatchGrowthSeries, date: string) {
  let count: number | null = null;
  for (const [pointDate, pointCount] of series.points) {
    if (pointDate > date) break;
    count = pointCount;
  }
  return count;
}

/** Days from the batch's first appearance until it first reached `target`. */
export function daysToReach(series: BatchGrowthSeries, target: number) {
  const match = series.points.find(([, count]) => count >= target);
  return match ? daysBetween(series.firstObservedDate, match[0]) : null;
}
