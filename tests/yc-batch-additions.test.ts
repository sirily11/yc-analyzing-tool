import { describe, expect, it } from "vitest";
import {
  emptyBatchAdditionsFile,
  formatBatchAdditionsJson,
  mergeAdditionSnapshots,
  normalizeAddedCompany,
  parseBatchAdditionsFile,
  parseChangesPayload,
} from "@/lib/yc/batch-growth";

const upstreamCompany = {
  id: 21792,
  name: "RingMD",
  slug: "ringmd",
  former_names: [],
  small_logo_thumb_url: "https://bookface-images.s3.amazonaws.com/small_logos/ac5b.png",
  website: "https://www.ring.md",
  all_locations: "Charleston, SC, USA",
  long_description: "We partner with healthcare groups and governments…",
  one_liner: "We work with governments to implement telemedicine programs.",
  team_size: 32,
  industry: "Government",
  subindustry: "Government",
  launched_at: 1599762607,
  tags: ["Telehealth"],
  batch: "Summer 2020",
  status: "Active",
  url: "https://www.ycombinator.com/companies/ringmd",
};

const changesPayload = {
  generated_at: "2026-08-11T01:00:45.814Z",
  summary: { previous_total: 6139, current_total: 6144, added: 1, removed: 0, updated: 33 },
  added: [upstreamCompany],
  removed: [],
  updated: [],
};

describe("upstream change payload parsing", () => {
  it("trims the full upstream record to the stored fields", () => {
    const company = normalizeAddedCompany(upstreamCompany, "2026-08-11")!;
    expect(company).toEqual({
      id: 21792,
      name: "RingMD",
      slug: "ringmd",
      batch: "Summer 2020",
      batchKey: "summer-2020",
      oneLiner: "We work with governments to implement telemedicine programs.",
      industry: "Government",
      location: "Charleston, SC, USA",
      teamSize: 32,
      status: "Active",
      website: "https://www.ring.md",
      logo: "https://bookface-images.s3.amazonaws.com/small_logos/ac5b.png",
      url: "https://www.ycombinator.com/companies/ringmd",
      addedOn: "2026-08-11",
    });
    // Bulky upstream fields must not survive into the committed file.
    expect(company).not.toHaveProperty("long_description");
    expect(company).not.toHaveProperty("launched_at");
  });

  it("builds the YC url from the slug when upstream omits it", () => {
    const company = normalizeAddedCompany({ ...upstreamCompany, url: undefined }, "2026-08-11")!;
    expect(company.url).toBe("https://www.ycombinator.com/companies/ringmd");
  });

  it("tolerates missing optional fields and drops unusable rows", () => {
    const sparse = normalizeAddedCompany({ id: 5, name: "Tiny", slug: "tiny" }, "2026-08-11")!;
    expect(sparse.website).toBeNull();
    expect(sparse.logo).toBeNull();
    expect(sparse.teamSize).toBeNull();
    expect(sparse.batchKey).toBeNull();

    expect(normalizeAddedCompany({ name: "No id", slug: "no-id" }, "2026-08-11")).toBeNull();
    expect(normalizeAddedCompany({ id: 7, slug: "no-name" }, "2026-08-11")).toBeNull();
    expect(normalizeAddedCompany(null, "2026-08-11")).toBeNull();
  });

  it("extracts the daily summary alongside the companies", () => {
    const { day, companies } = parseChangesPayload(changesPayload, "2026-08-11");
    expect(day).toEqual({ date: "2026-08-11", added: 1, removed: 0, updated: 33, total: 6144 });
    expect(companies).toHaveLength(1);
  });
});

describe("additions merging", () => {
  const today = "2026-08-11";
  const snapshotFor = (date: string, id: number, name: string) => ({
    day: { date, added: 1, removed: 0, updated: 0, total: 6144 },
    companies: [normalizeAddedCompany({ ...upstreamCompany, id, name, slug: name.toLowerCase() }, date)!],
  });

  it("sorts newest-first and records the window bounds", () => {
    const file = mergeAdditionSnapshots(
      emptyBatchAdditionsFile(),
      [snapshotFor("2026-08-09", 1, "Alpha"), snapshotFor("2026-08-11", 2, "Beta")],
      { today },
    );
    expect(file.companies.map((company) => company.name)).toEqual(["Beta", "Alpha"]);
    expect(file.lastDate).toBe("2026-08-11");
    expect(file.firstDate).toBe("2026-08-09");
  });

  it("drops days and companies older than the rolling window", () => {
    const file = mergeAdditionSnapshots(
      emptyBatchAdditionsFile(),
      [snapshotFor("2026-01-01", 1, "Ancient"), snapshotFor("2026-08-11", 2, "Fresh")],
      { today, windowDays: 90 },
    );
    expect(file.companies.map((company) => company.name)).toEqual(["Fresh"]);
    expect(file.days.map((day) => day.date)).toEqual(["2026-08-11"]);
  });

  it("dedupes by id, keeping the newest sighting", () => {
    const file = mergeAdditionSnapshots(
      emptyBatchAdditionsFile(),
      [snapshotFor("2026-08-01", 42, "Repeat"), snapshotFor("2026-08-10", 42, "Repeat")],
      { today },
    );
    expect(file.companies).toHaveLength(1);
    expect(file.companies[0].addedOn).toBe("2026-08-10");
  });

  it("enforces the maximum entry count", () => {
    const snapshots = Array.from({ length: 10 }, (_, index) => snapshotFor("2026-08-10", index + 1, `Company${index}`));
    const file = mergeAdditionSnapshots(emptyBatchAdditionsFile(), snapshots, { today, maxEntries: 4 });
    expect(file.companies).toHaveLength(4);
  });

  it("is idempotent and round-trips through the parser", () => {
    const once = mergeAdditionSnapshots(emptyBatchAdditionsFile(), [snapshotFor("2026-08-11", 2, "Beta")], { today });
    const twice = mergeAdditionSnapshots(once, [snapshotFor("2026-08-11", 2, "Beta")], { today });
    const json = formatBatchAdditionsJson(once);
    expect(formatBatchAdditionsJson(twice)).toBe(json);
    expect(json).not.toMatch(/generatedAt/);
    expect(formatBatchAdditionsJson(parseBatchAdditionsFile(JSON.parse(json)))).toBe(json);
  });
});
