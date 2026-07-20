import "server-only";
import { createHash } from "node:crypto";
import type { Client, InStatement, ResultSet, Row, Value } from "@libsql/client";
import { embed } from "ai";
import { z } from "zod";
import { client } from "@/lib/db";
import type { DatasetManifest, YcCompany } from "@/lib/types/company";
import { YC_EMBEDDING_DIMENSIONS, YC_EMBEDDING_MODEL, validateYcEmbedding } from "@/lib/yc/embedding";
import { gatewayProviderOptions, normalizeEmbeddingUsage, recordAiUsage, type MeteringContext } from "@/lib/billing/usage";

export { YC_EMBEDDING_DIMENSIONS, YC_EMBEDDING_MODEL } from "@/lib/yc/embedding";

export const YC_FIRST_YEAR = 2020;
export const YC_LAST_YEAR = new Date().getUTCFullYear();

const filterSchema = {
  years: z.array(z.number().int().min(YC_FIRST_YEAR).max(YC_LAST_YEAR)).max(YC_LAST_YEAR - YC_FIRST_YEAR + 1).optional(),
  batches: z.array(z.string().min(1).max(80)).max(50).optional(),
  industries: z.array(z.string().min(1).max(120)).max(20).optional(),
  targetMarkets: z.array(z.string().min(1).max(120)).max(20).optional(),
  locations: z.array(z.string().min(1).max(120)).max(20).optional(),
  operatingAreas: z.array(z.string().min(1).max(120)).max(20).optional(),
  aiLinked: z.boolean().optional(),
  hiring: z.boolean().optional(),
};

export const companySearchInputSchema = z.object({
  query: z.string().max(500).optional(),
  ...filterSchema,
  limit: z.number().int().min(1).max(50).default(10),
});

export const companyListInputSchema = z.object({
  ...filterSchema,
  limit: z.number().int().min(1).max(5_000).default(5_000),
});

export type CompanySearchInput = z.infer<typeof companySearchInputSchema>;
export type CompanyListInput = z.input<typeof companyListInputSchema>;
export type YcDatasetManifest = DatasetManifest & {
  embeddingModel: string;
  embeddingDimensions: number;
};

export const exactCompanyIdsSchema = z.array(z.number().int()).min(1).max(10);

export type YcSqlExecutor = Pick<Client, "execute">;
export type YcQueryEmbedder = (value: string, model: string) => Promise<number[]>;

export type YcCompanyQueryOptions = {
  executor?: YcSqlExecutor;
  embed?: YcQueryEmbedder;
  metering?: MeteringContext;
};

const EMBEDDING_CACHE_LIMIT = 200;
const defaultEmbeddingCache = new Map<string, Promise<number[]>>();
let injectedEmbeddingCaches = new WeakMap<YcQueryEmbedder, Map<string, Promise<number[]>>>();

const COMPANY_COLUMNS = [
  "id", "name", "slug", "website", "batch", "year", "industry", "subindustry",
  "one_liner", "location", "operating_area", "target_market", "ai_linked", "hiring",
  "logo", "x", "y",
].join(", ");

function executor(options?: YcCompanyQueryOptions) {
  return options?.executor ?? client;
}

function requiredString(row: Row, key: string) {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`YC_COMPANY_ROW_INVALID:${key}`);
  return value;
}

function nullableString(row: Row, key: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`YC_COMPANY_ROW_INVALID:${key}`);
  return value;
}

function requiredNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`YC_COMPANY_ROW_INVALID:${key}`);
  return value;
}

function companyFromRow(row: Row): YcCompany {
  return {
    id: requiredNumber(row, "id"),
    name: requiredString(row, "name"),
    slug: requiredString(row, "slug"),
    website: nullableString(row, "website"),
    batch: requiredString(row, "batch"),
    year: requiredNumber(row, "year"),
    industry: requiredString(row, "industry"),
    subindustry: requiredString(row, "subindustry"),
    oneLiner: requiredString(row, "one_liner"),
    location: requiredString(row, "location"),
    operatingArea: requiredString(row, "operating_area"),
    targetMarket: requiredString(row, "target_market"),
    aiLinked: requiredNumber(row, "ai_linked") !== 0,
    hiring: requiredNumber(row, "hiring") !== 0,
    logo: nullableString(row, "logo"),
    x: requiredNumber(row, "x"),
    y: requiredNumber(row, "y"),
  };
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(", ");
}

type CompanyFilters = Omit<CompanySearchInput, "query" | "limit">;

function companyWhere(input: CompanyFilters) {
  const clauses: string[] = [];
  const args: Value[] = [];
  const addIn = (column: string, values: readonly (string | number)[] | undefined) => {
    if (!values?.length) return;
    clauses.push(`${column} IN (${placeholders(values)})`);
    args.push(...values);
  };

  addIn("year", input.years);
  addIn("batch", input.batches);
  addIn("industry", input.industries);
  addIn("target_market", input.targetMarkets);
  addIn("operating_area", input.operatingAreas);
  if (input.locations?.length) {
    clauses.push(`(${input.locations.map(() => "instr(lower(location), ?) > 0").join(" OR ")})`);
    args.push(...input.locations.map((location) => location.trim().toLowerCase()));
  }
  if (input.aiLinked !== undefined) {
    clauses.push("ai_linked = ?");
    args.push(input.aiLinked ? 1 : 0);
  }
  if (input.hiring !== undefined) {
    clauses.push("hiring = ?");
    args.push(input.hiring ? 1 : 0);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", args };
}

function countFromResult(result: ResultSet) {
  const value = result.rows[0]?.total;
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") throw new Error("YC_COMPANY_COUNT_INVALID");
  return value;
}

async function queryCompanies(input: CompanyFilters, limit: number | undefined, options?: YcCompanyQueryOptions) {
  const where = companyWhere(input);
  const limitSql = limit === undefined ? "" : " LIMIT ?";
  const args = limit === undefined ? where.args : [...where.args, limit];
  const [countResult, rowsResult] = await Promise.all([
    executor(options).execute({ sql: `SELECT count(*) AS total FROM yc_companies${where.sql}`, args: where.args }),
    executor(options).execute({
      sql: `SELECT ${COMPANY_COLUMNS} FROM yc_companies${where.sql} ORDER BY year DESC, name COLLATE NOCASE ASC, id ASC${limitSql}`,
      args,
    }),
  ]);
  return { total: countFromResult(countResult), companies: rowsResult.rows.map(companyFromRow) };
}

export async function listYcCompanies(rawInput: CompanyListInput = {}, options?: YcCompanyQueryOptions) {
  const { limit, ...filters } = companyListInputSchema.parse(rawInput);
  return queryCompanies(filters, limit, options);
}

export async function loadYcCompanies(
  rawInput: Omit<CompanyListInput, "limit"> = {},
  options?: YcCompanyQueryOptions,
) {
  const filters = companyListInputSchema.omit({ limit: true }).parse(rawInput);
  const where = companyWhere(filters);
  const result = await executor(options).execute({
    sql: `SELECT ${COMPANY_COLUMNS} FROM yc_companies${where.sql} ORDER BY year DESC, name COLLATE NOCASE ASC, id ASC`,
    args: where.args,
  });
  return result.rows.map(companyFromRow);
}

function stringArray(value: Value | undefined, key: string) {
  if (typeof value !== "string") throw new Error(`YC_DATASET_MANIFEST_INVALID:${key}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`YC_DATASET_MANIFEST_INVALID:${key}`);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`YC_DATASET_MANIFEST_INVALID:${key}`);
  }
  return parsed as string[];
}

export async function loadYcDatasetManifest(options?: YcCompanyQueryOptions): Promise<YcDatasetManifest> {
  const result = await executor(options).execute({
    sql: "SELECT version, source, generated_at, first_year, last_year, company_count, batches, industries, embedding_model, embedding_dimensions FROM yc_dataset_manifest WHERE id = 1",
    args: [],
  });
  const row = result.rows[0];
  if (!row) throw new Error("YC_DATASET_MANIFEST_NOT_FOUND");
  return {
    version: requiredString(row, "version"),
    source: requiredString(row, "source"),
    generatedAt: requiredString(row, "generated_at"),
    firstYear: requiredNumber(row, "first_year"),
    lastYear: requiredNumber(row, "last_year"),
    companyCount: requiredNumber(row, "company_count"),
    batches: stringArray(row.batches, "batches"),
    industries: stringArray(row.industries, "industries"),
    embeddingModel: requiredString(row, "embedding_model"),
    embeddingDimensions: requiredNumber(row, "embedding_dimensions"),
  };
}

function validateSearchManifest(manifest: YcDatasetManifest) {
  if (manifest.embeddingModel !== YC_EMBEDDING_MODEL) {
    throw new Error(`YC_EMBEDDING_MODEL_MISMATCH:${manifest.embeddingModel}`);
  }
  if (manifest.embeddingDimensions !== YC_EMBEDDING_DIMENSIONS) {
    throw new Error(`YC_EMBEDDING_DIMENSIONS_MISMATCH:${manifest.embeddingDimensions}`);
  }
}

async function embedQuery(value: string, model: string, suppliedContext?: MeteringContext) {
  const operationId = `public-semantic:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
  const context = suppliedContext ?? { userId: null, reservationId: null, feature: "Public semantic search", operationId };
  const result = await embed({ model, value, providerOptions: gatewayProviderOptions(context) });
  await recordAiUsage({
    context,
    model,
    providerMetadata: result.providerMetadata,
    usage: normalizeEmbeddingUsage(result.usage),
    eventId: operationId,
  });
  return result.embedding;
}

function embeddingCache(embedder: YcQueryEmbedder) {
  if (embedder === embedQuery) return defaultEmbeddingCache;
  let cache = injectedEmbeddingCaches.get(embedder);
  if (!cache) {
    cache = new Map();
    injectedEmbeddingCaches.set(embedder, cache);
  }
  return cache;
}

function normalizeSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function cachedEmbedding(value: string, embedder: YcQueryEmbedder, metering?: MeteringContext) {
  const key = `${YC_EMBEDDING_MODEL}\n${value}`;
  const cache = embeddingCache(embedder);
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }

  const pending = (embedder === embedQuery
    ? embedQuery(value, YC_EMBEDDING_MODEL, metering)
    : embedder(value, YC_EMBEDDING_MODEL)).then((embedding) => {
    validateYcEmbedding(embedding);
    return embedding;
  });
  cache.set(key, pending);
  if (cache.size > EMBEDDING_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  try {
    return await pending;
  } catch (error) {
    if (cache.get(key) === pending) cache.delete(key);
    throw error;
  }
}

export function clearYcEmbeddingCache() {
  defaultEmbeddingCache.clear();
  injectedEmbeddingCaches = new WeakMap();
}

export async function searchYcCompanies(rawInput: CompanySearchInput, options?: YcCompanyQueryOptions) {
  const { query: rawQuery, limit, ...filters } = companySearchInputSchema.parse(rawInput);
  const query = normalizeSearchQuery(rawQuery ?? "");
  if (!query) return queryCompanies(filters, limit, options);

  const manifest = await loadYcDatasetManifest(options);
  validateSearchManifest(manifest);
  const embedding = await cachedEmbedding(query, options?.embed ?? embedQuery, options?.metering);

  const where = companyWhere(filters);
  const vector = JSON.stringify(embedding);
  const embeddingModelClause = where.sql ? `${where.sql} AND embedding_model = ?` : " WHERE embedding_model = ?";
  const rowsResult = await executor(options).execute({
    sql: `SELECT ${COMPANY_COLUMNS}, vector_distance_cos(embedding, vector32(?)) AS semantic_distance FROM yc_companies${embeddingModelClause} ORDER BY semantic_distance ASC, year DESC, name COLLATE NOCASE ASC, id ASC LIMIT ?`,
    args: [vector, ...where.args, manifest.embeddingModel, limit],
  });
  const companies = rowsResult.rows.map(companyFromRow);
  return { total: companies.length, companies };
}

export function resolveExactYcCompanies(companies: YcCompany[], rawIds: number[]) {
  const ids = [...new Set(exactCompanyIdsSchema.parse(rawIds))];
  const lookup = new Map(companies.map((company) => [company.id, company]));
  const resolved = ids.flatMap((id) => lookup.get(id) ?? []);
  if (resolved.length !== ids.length) throw new Error("YC_COMPANY_NOT_FOUND");
  return resolved;
}

export async function getYcCompaniesByIds(rawIds: number[], options?: YcCompanyQueryOptions) {
  const ids = [...new Set(exactCompanyIdsSchema.parse(rawIds))];
  const result = await executor(options).execute({
    sql: `SELECT ${COMPANY_COLUMNS} FROM yc_companies WHERE id IN (${placeholders(ids)})`,
    args: ids,
  } satisfies Exclude<InStatement, string>);
  const companies = result.rows.map(companyFromRow);
  return resolveExactYcCompanies(companies, ids);
}
