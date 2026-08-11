import { describe, expect, it } from "vitest";
import {
  addUtcDays,
  compactSeries,
  compareBatchKeys,
  countOnDate,
  daysToReach,
  emptyBatchGrowthFile,
  formatBatchGrowthJson,
  insertObservedDate,
  lastCommitPerDate,
  mergeBatchSnapshots,
  missingObservedDates,
  parseBatchGrowthFile,
  parseBatchKey,
  parseBatchMeta,
  type BatchSnapshot,
} from "@/lib/yc/batch-growth";

function snapshot(date: string, counts: Record<string, number>): BatchSnapshot {
  return {
    date,
    counts: Object.entries(counts).map(([key, count]) => ({ key, name: key, count })),
  };
}

describe("batch key parsing", () => {
  it("collapses the upstream rename from short codes to long form", () => {
    // Upstream renamed w24 -> winter-2024 in ~May 2025. Both spellings must reach one key.
    for (const value of ["w25", "W25", "winter-2025", "Winter 2025", "WINTER-2025"]) {
      expect(parseBatchKey(value)?.key).toBe("winter-2025");
    }
    expect(parseBatchKey("x25")?.key).toBe("spring-2025");
    expect(parseBatchKey("X25")?.key).toBe("spring-2025");
    expect(parseBatchKey("f24")?.key).toBe("fall-2024");
    expect(parseBatchKey("s24")?.key).toBe("summer-2024");
  });

  it("rejects the non-batch keys upstream ships alongside real batches", () => {
    expect(parseBatchKey("unspecified")).toBeNull();
    expect(parseBatchKey("ik12")).toBeNull();
    expect(parseBatchKey("")).toBeNull();
    expect(parseBatchKey("summer-20x6")).toBeNull();
    expect(parseBatchKey("nonsense")).toBeNull();
  });

  it("orders batches chronologically within a year", () => {
    const keys = ["fall-2026", "winter-2027", "summer-2026", "winter-2026", "spring-2026"];
    const sorted = keys.map((key) => parseBatchKey(key)!).sort(compareBatchKeys).map((item) => item.key);
    expect(sorted).toEqual(["winter-2026", "spring-2026", "summer-2026", "fall-2026", "winter-2027"]);
  });
});

describe("meta.json parsing", () => {
  const meta = {
    last_updated: "2026-08-11T01:00:45.814Z",
    batches: {
      "winter-2027": { name: "Winter 2027", count: 1 },
      "summer-2026": { name: "Summer 2026", count: 197 },
      unspecified: { name: "Unspecified", count: 1 },
      ik12: { name: "IK12", count: 76 },
    },
  };

  it("drops unspecified and legacy keys, and returns batches in chronological order", () => {
    const parsed = parseBatchMeta(meta, "2026-08-11");
    expect(parsed.counts.map((item) => item.key)).toEqual(["summer-2026", "winter-2027"]);
    expect(parsed.counts[0].count).toBe(197);
    expect(parsed.counts[0].name).toBe("Summer 2026");
  });

  it("throws when the batches object is absent", () => {
    expect(() => parseBatchMeta({ last_updated: "x" }, "2026-08-11")).toThrow(/batches/);
    expect(() => parseBatchMeta(null, "2026-08-11")).toThrow();
  });

  it("ignores entries without a usable count", () => {
    const parsed = parseBatchMeta({ batches: { "summer-2026": { count: -4 }, "fall-2026": { count: 10 } } }, "2026-08-11");
    expect(parsed.counts.map((item) => item.key)).toEqual(["fall-2026"]);
  });
});

describe("sparse series compaction", () => {
  it("sorts, dedupes by date, and drops repeated counts", () => {
    const compacted = compactSeries([
      ["2026-08-03", 10],
      ["2026-08-01", 3],
      ["2026-08-02", 3],
      ["2026-08-03", 12],
      ["2026-08-04", 12],
    ]);
    expect(compacted).toEqual([
      ["2026-08-01", 3],
      ["2026-08-03", 12],
    ]);
  });

  it("always keeps the very first point", () => {
    expect(compactSeries([["2026-08-01", 0]])).toEqual([["2026-08-01", 0]]);
  });
});

describe("observed date ranges", () => {
  it("merges adjacent days into one range but preserves real gaps", () => {
    let ranges = insertObservedDate([], "2026-08-01");
    ranges = insertObservedDate(ranges, "2026-08-02");
    ranges = insertObservedDate(ranges, "2026-08-03");
    expect(ranges).toEqual([["2026-08-01", "2026-08-03"]]);

    ranges = insertObservedDate(ranges, "2026-08-06");
    expect(ranges).toEqual([
      ["2026-08-01", "2026-08-03"],
      ["2026-08-06", "2026-08-06"],
    ]);

    // Filling the gap collapses both ranges back into one.
    ranges = insertObservedDate(ranges, "2026-08-04");
    ranges = insertObservedDate(ranges, "2026-08-05");
    expect(ranges).toEqual([["2026-08-01", "2026-08-06"]]);
  });

  it("is a no-op for an already observed date", () => {
    const ranges = insertObservedDate(insertObservedDate([], "2026-08-01"), "2026-08-01");
    expect(ranges).toEqual([["2026-08-01", "2026-08-01"]]);
  });

  it("reports exactly the unobserved candidates, ascending", () => {
    const ranges = [["2026-08-01", "2026-08-03"]] as const;
    expect(missingObservedDates(ranges, ["2026-08-05", "2026-08-02", "2026-08-04", "2026-08-05"])).toEqual([
      "2026-08-04",
      "2026-08-05",
    ]);
  });
});

describe("snapshot merging", () => {
  const day1 = snapshot("2026-08-01", { "summer-2026": 100, "fall-2026": 1 });
  const day2 = snapshot("2026-08-02", { "summer-2026": 100, "fall-2026": 4 });
  const day3 = snapshot("2026-08-03", { "summer-2026": 120, "fall-2026": 4 });

  it("writes a point only when a count actually changes", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [day1, day2, day3]);
    const summer = file.batches.find((batch) => batch.key === "summer-2026")!;
    expect(summer.points).toEqual([
      ["2026-08-01", 100],
      ["2026-08-03", 120],
    ]);
    expect(summer.latestCount).toBe(120);
    expect(file.firstObservedDate).toBe("2026-08-01");
    expect(file.lastObservedDate).toBe("2026-08-03");
  });

  it("is idempotent when the same snapshots are merged twice", () => {
    const once = mergeBatchSnapshots(emptyBatchGrowthFile(), [day1, day2, day3]);
    const twice = mergeBatchSnapshots(once, [day1, day2, day3]);
    expect(formatBatchGrowthJson(twice)).toBe(formatBatchGrowthJson(once));
  });

  it("is order-independent, so a backfill of older dates matches an in-order build", () => {
    // This is the property that makes `--backfill` safe: it inserts dates older than what is
    // already stored, so an append-only merge would corrupt the series.
    const inOrder = mergeBatchSnapshots(emptyBatchGrowthFile(), [day1, day2, day3]);
    const backwards = mergeBatchSnapshots(
      mergeBatchSnapshots(emptyBatchGrowthFile(), [day3]),
      [day1, day2],
    );
    expect(formatBatchGrowthJson(backwards)).toBe(formatBatchGrowthJson(inOrder));
  });

  it("starts a new batch at its own first appearance, not at the file start", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2026-08-01", { "summer-2026": 100 }),
      snapshot("2026-08-02", { "summer-2026": 100, "winter-2027": 1 }),
    ]);
    const winter = file.batches.find((batch) => batch.key === "winter-2027")!;
    expect(winter.firstObservedDate).toBe("2026-08-02");
    expect(winter.points).toEqual([["2026-08-02", 1]]);
  });

  it("flags batches that already existed on the first sampled day as censored", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2026-08-01", { "summer-2020": 209 }),
      snapshot("2026-08-02", { "summer-2020": 209, "winter-2027": 1 }),
    ]);
    expect(file.batches.find((batch) => batch.key === "summer-2020")!.censored).toBe(true);
    expect(file.batches.find((batch) => batch.key === "winter-2027")!.censored).toBe(false);
  });

  it("leaves a series untouched when its key is absent from a later snapshot", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2026-08-01", { "summer-2026": 100 }),
      snapshot("2026-08-02", {}),
    ]);
    const summer = file.batches.find((batch) => batch.key === "summer-2026")!;
    expect(summer.points).toEqual([["2026-08-01", 100]]);
    expect(summer.latestCount).toBe(100);
  });

  it("unifies a batch that spans the upstream key rename", () => {
    const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
      snapshot("2025-04-16", { w25: 147 }),
      snapshot("2025-05-06", { "winter-2025": 164 }),
    ]);
    expect(file.batches.filter((batch) => batch.key === "winter-2025")).toHaveLength(1);
    expect(file.batches.find((batch) => batch.key === "winter-2025")!.points).toEqual([
      ["2025-04-16", 147],
      ["2025-05-06", 164],
    ]);
  });
});

describe("serialization", () => {
  const file = mergeBatchSnapshots(emptyBatchGrowthFile(), [
    snapshot("2026-08-01", { "summer-2026": 100 }),
    snapshot("2026-08-02", { "summer-2026": 120 }),
  ]);

  it("stores no wall-clock timestamp, so an unchanged upstream yields a zero-byte diff", () => {
    const json = formatBatchGrowthJson(file);
    expect(json).not.toMatch(/generatedAt|last_updated/);
    expect(formatBatchGrowthJson(file)).toBe(json);
  });

  it("writes one compact line per batch and round-trips through the parser", () => {
    const json = formatBatchGrowthJson(file);
    expect(json.endsWith("\n")).toBe(true);
    expect(json).toContain('    {"key":"summer-2026"');
    expect(formatBatchGrowthJson(parseBatchGrowthFile(JSON.parse(json)))).toBe(json);
  });

  it("rejects an unsupported version and malformed points", () => {
    expect(() => parseBatchGrowthFile({ version: 2, batches: [], observedRanges: [] })).toThrow(/version/);
    expect(() =>
      parseBatchGrowthFile({
        version: 1,
        observedRanges: [],
        batches: [{ key: "summer-2026", points: [["2026-08-01"]] }],
      }),
    ).toThrow(/malformed point/);
  });
});

describe("commit de-duplication", () => {
  it("keeps the newest commit for each UTC date, ascending", () => {
    const commits = [
      { sha: "newest", date: "2026-08-11T01:00:49Z" },
      { sha: "earlier-same-day", date: "2026-08-11T00:10:00Z" },
      { sha: "yesterday", date: "2026-08-10T01:01:44Z" },
    ];
    expect(lastCommitPerDate(commits)).toEqual([
      { date: "2026-08-10", sha: "yesterday" },
      { date: "2026-08-11", sha: "newest" },
    ]);
  });
});

describe("derived readings", () => {
  const series = mergeBatchSnapshots(emptyBatchGrowthFile(), [
    snapshot("2026-07-01", { "fall-2026": 1 }),
    snapshot("2026-07-15", { "fall-2026": 60 }),
    snapshot("2026-08-01", { "fall-2026": 140 }),
  ]).batches[0];

  it("reads the step function forward from the previous point", () => {
    expect(countOnDate(series, "2026-06-30")).toBeNull();
    expect(countOnDate(series, "2026-07-01")).toBe(1);
    expect(countOnDate(series, "2026-07-14")).toBe(1);
    expect(countOnDate(series, "2026-07-20")).toBe(60);
    expect(countOnDate(series, "2027-01-01")).toBe(140);
  });

  it("measures days from first appearance to a milestone", () => {
    expect(daysToReach(series, 50)).toBe(14);
    expect(daysToReach(series, 140)).toBe(31);
    expect(daysToReach(series, 500)).toBeNull();
  });

  it("shifts UTC dates without drifting across month boundaries", () => {
    expect(addUtcDays("2026-08-01", -1)).toBe("2026-07-31");
    expect(addUtcDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
