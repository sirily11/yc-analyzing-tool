import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BATCH_CHANGES_BASE_URL,
  BATCH_CHANGES_FIRST_DATE,
  YC_OSS_REPO,
  emptyBatchAdditionsFile,
  emptyBatchGrowthFile,
  formatBatchAdditionsJson,
  formatBatchGrowthJson,
  lastCommitPerDate,
  mergeAdditionSnapshots,
  mergeBatchSnapshots,
  missingObservedDates,
  parseBatchAdditionsFile,
  parseBatchGrowthFile,
  parseBatchMeta,
  parseChangesPayload,
  type BatchAdditionCompany,
  type BatchAdditionDay,
  type BatchSnapshot,
} from "../lib/yc/batch-growth";

const GROWTH_FILE_NAME = "yc-batch-growth.json";
const ADDITIONS_FILE_NAME = "yc-batch-additions.json";
const USER_AGENT = "Application-Signal YC batch growth";
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_INCREMENTAL_LIMIT = 60;
const MAX_ATTEMPTS = 3;

export type UpdateBatchGrowthOptions = {
  dataDirectory?: string;
  fetchImplementation?: typeof fetch;
  backfill?: boolean;
  since?: string;
  limit?: number;
  concurrency?: number;
  dryRun?: boolean;
  token?: string;
  now?: Date;
};

export type UpdateBatchGrowthResult = {
  fetchedDates: string[];
  skippedDates: string[];
  batchCount: number;
  addedCompanies: number;
  wroteFiles: boolean;
};

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJsonFile(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${filePath}.`, { cause: error });
  }
}

/**
 * Retries on 429 and 5xx, honouring `Retry-After`. A 404 is returned as null because
 * `changes/<date>.json` legitimately does not exist before the feed started.
 */
async function fetchWithRetry(
  url: string,
  fetchImplementation: typeof fetch,
  options: { headers?: Record<string, string>; allowNotFound?: boolean } = {},
) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let retryAfterSeconds = 0;
    try {
      const response = await fetchImplementation(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...options.headers },
      });
      if (response.status === 404 && options.allowNotFound) return null;
      if (response.ok) return response;
      // 4xx other than 429 will never succeed on a retry — fail immediately rather than
      // burning two more attempts and three seconds of backoff per request.
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`${url} failed: ${response.status}`, { cause: "permanent" });
      }
      lastError = new Error(`${url} failed: ${response.status}`);
      const header = Number(response.headers.get("retry-after"));
      retryAfterSeconds = Number.isFinite(header) && header > 0 ? header : 0;
    } catch (error) {
      if (error instanceof Error && error.cause === "permanent") throw error;
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(retryAfterSeconds ? retryAfterSeconds * 1000 : 500 * 3 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error(`${url} failed.`);
}

/** Pages through the commit list for `meta.json`, following the `Link: rel="next"` header. */
async function listMetaCommits(options: {
  fetchImplementation: typeof fetch;
  since?: string;
  token?: string;
}) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const commits: { sha: string; date: string }[] = [];
  let url: string | null = `https://api.github.com/repos/${YC_OSS_REPO}/commits?path=meta.json&per_page=100${
    options.since ? `&since=${encodeURIComponent(`${options.since}T00:00:00Z`)}` : ""
  }`;

  while (url) {
    const response = await fetchWithRetry(url, options.fetchImplementation, { headers });
    if (!response) break;
    const page = (await response.json()) as unknown;
    if (!Array.isArray(page)) throw new Error("The GitHub commit listing did not return an array.");
    for (const entry of page) {
      const record = entry as { sha?: unknown; commit?: { committer?: { date?: unknown } } };
      const sha = typeof record.sha === "string" ? record.sha : "";
      const date = typeof record.commit?.committer?.date === "string" ? record.commit.committer.date : "";
      if (sha && date) commits.push({ sha, date });
    }
    const link = response.headers.get("link") ?? "";
    url = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
  }
  return commits;
}

/** Bounded worker pool so a 642-commit backfill does not open 642 sockets at once. */
async function mapWithConcurrency<Item, Value>(
  items: readonly Item[],
  concurrency: number,
  worker: (item: Item, index: number) => Promise<Value>,
) {
  const results = new Array<Value>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function updateBatchGrowth(options: UpdateBatchGrowthOptions = {}): Promise<UpdateBatchGrowthResult> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const dataDirectory = options.dataDirectory ?? path.join(process.cwd(), "data");
  const growthPath = path.join(dataDirectory, GROWTH_FILE_NAME);
  const additionsPath = path.join(dataDirectory, ADDITIONS_FILE_NAME);
  const now = options.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

  const storedGrowth = await readJsonFile(growthPath);
  const storedAdditions = await readJsonFile(additionsPath);
  const growth = storedGrowth ? parseBatchGrowthFile(storedGrowth) : emptyBatchGrowthFile();
  const additions = storedAdditions ? parseBatchAdditionsFile(storedAdditions) : emptyBatchAdditionsFile();

  // With no stored history there is nothing to be incremental about.
  const backfill = options.backfill || growth.observedRanges.length === 0;
  const since = backfill ? undefined : options.since ?? (growth.lastObservedDate || undefined);

  const commits = await listMetaCommits({ fetchImplementation, since, token });
  const perDate = lastCommitPerDate(commits);
  const missing = new Set(
    missingObservedDates(
      growth.observedRanges,
      perDate.map((commit) => commit.date),
    ),
  );
  const limit = options.limit ?? (backfill ? Number.POSITIVE_INFINITY : DEFAULT_INCREMENTAL_LIMIT);
  const targets = perDate.filter((commit) => missing.has(commit.date)).slice(0, limit);

  if (targets.length === 0) {
    return {
      fetchedDates: [],
      skippedDates: [],
      batchCount: growth.batches.length,
      addedCompanies: 0,
      wroteFiles: false,
    };
  }

  const newestDate = targets[targets.length - 1].date;
  const skippedDates: string[] = [];

  const snapshots = await mapWithConcurrency(
    targets,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (commit): Promise<BatchSnapshot | null> => {
      try {
        const response = await fetchWithRetry(
          `https://raw.githubusercontent.com/${YC_OSS_REPO}/${commit.sha}/meta.json`,
          fetchImplementation,
        );
        return parseBatchMeta(await response!.json(), commit.date);
      } catch (error) {
        // A bad historical blob must not block today's update; it stays missing and is retried
        // on the next run. A bad *newest* blob is a real failure and should fail the workflow.
        if (commit.date === newestDate) throw error;
        skippedDates.push(commit.date);
        return null;
      }
    },
  );

  const nextGrowth = mergeBatchSnapshots(
    growth,
    snapshots.filter((snapshot): snapshot is BatchSnapshot => snapshot !== null),
  );

  const changeDates = targets.map((commit) => commit.date).filter((date) => date >= BATCH_CHANGES_FIRST_DATE);
  const changeSnapshots = await mapWithConcurrency(
    changeDates,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (date): Promise<{ day: BatchAdditionDay; companies: BatchAdditionCompany[] } | null> => {
      const response = await fetchWithRetry(`${BATCH_CHANGES_BASE_URL}${date}.json`, fetchImplementation, {
        allowNotFound: true,
      });
      return response ? parseChangesPayload(await response.json(), date) : null;
    },
  );

  const resolvedChanges = changeSnapshots.filter(
    (snapshot): snapshot is { day: BatchAdditionDay; companies: BatchAdditionCompany[] } => snapshot !== null,
  );
  const nextAdditions = mergeAdditionSnapshots(additions, resolvedChanges, { today });

  const result: UpdateBatchGrowthResult = {
    fetchedDates: targets.map((commit) => commit.date).filter((date) => !skippedDates.includes(date)),
    skippedDates,
    batchCount: nextGrowth.batches.length,
    addedCompanies: resolvedChanges.reduce((total, snapshot) => total + snapshot.companies.length, 0),
    wroteFiles: false,
  };
  if (options.dryRun) return result;

  await mkdir(dataDirectory, { recursive: true });
  await writeFile(growthPath, formatBatchGrowthJson(nextGrowth), "utf8");
  await writeFile(additionsPath, formatBatchAdditionsJson(nextAdditions), "utf8");
  return { ...result, wroteFiles: true };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const valueFor = (flag: string) => {
    const inline = argv.find((item) => item.startsWith(`${flag}=`));
    if (inline) return inline.slice(flag.length + 1);
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const limit = valueFor("--limit");

  updateBatchGrowth({
    backfill: argv.includes("--backfill"),
    dryRun: argv.includes("--dry-run"),
    since: valueFor("--since"),
    limit: limit ? Number(limit) : undefined,
  })
    .then((result) => {
      if (result.fetchedDates.length === 0 && result.skippedDates.length === 0) {
        console.log("Batch growth is up to date. No dates to fetch.");
        return;
      }
      const range = result.fetchedDates.length
        ? `${result.fetchedDates[0]} → ${result.fetchedDates[result.fetchedDates.length - 1]}`
        : "none";
      console.log(
        `Batch growth updated: ${result.fetchedDates.length} dates (${range}), ${result.batchCount} batches, ` +
          `${result.addedCompanies} newly added companies` +
          `${result.skippedDates.length ? `, ${result.skippedDates.length} skipped (${result.skippedDates.join(", ")})` : ""}` +
          `${result.wroteFiles ? "" : " [dry run, nothing written]"}`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
