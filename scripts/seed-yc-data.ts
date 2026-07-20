import { createHash } from "node:crypto";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { embedMany } from "ai";
import { appConfig } from "../config";
import {
  createYcDatasetManifest,
  currentUtcYear,
  YC_FIRST_YEAR,
  YC_SOURCE_URL,
  type YcCompanySourceRecord,
} from "../lib/yc/source";
import { YC_EMBEDDING_DIMENSIONS } from "../lib/yc/embedding";
import { loadNormalizedYcCompanies } from "./yc-data-source";

export { YC_EMBEDDING_DIMENSIONS } from "../lib/yc/embedding";
const DEFAULT_EMBEDDING_BATCH_SIZE = 64;

export type YcSeedEnvironment = {
  databaseUrl: string;
  authToken: string;
  embeddingModel: string;
  embeddingBatchSize: number;
  embeddingParallelism: number;
};

function boundedInteger(value: string | undefined, fallback: number, label: string, maximum: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

export function requireRemoteTursoEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): YcSeedEnvironment {
  const databaseUrl = environment.TURSO_DATABASE_URL?.trim() ?? "";
  if (!databaseUrl || databaseUrl === ":memory:" || /^file:/i.test(databaseUrl)) {
    throw new Error("yc:seed and yc:sync require a remote, non-file TURSO_DATABASE_URL.");
  }
  try {
    const url = new URL(databaseUrl);
    if (!["libsql:", "https:", "http:", "wss:", "ws:"].includes(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new Error("TURSO_DATABASE_URL must be a valid remote libSQL URL.");
  }

  const authToken = environment.TURSO_AUTH_TOKEN?.trim() ?? "";
  if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required for yc:seed and yc:sync.");
  if (!environment.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("AI_GATEWAY_API_KEY is required to embed YC companies.");
  }

  return {
    databaseUrl,
    authToken,
    embeddingModel: environment.AI_EMBEDDING_MODEL?.trim() || "openai/text-embedding-3-small",
    embeddingBatchSize: boundedInteger(environment.YC_EMBEDDING_BATCH_SIZE, DEFAULT_EMBEDDING_BATCH_SIZE, "YC_EMBEDDING_BATCH_SIZE", 256),
    embeddingParallelism: boundedInteger(environment.YC_EMBEDDING_PARALLELISM, 4, "YC_EMBEDDING_PARALLELISM", 16),
  };
}

export function validateYcEmbeddings(
  embeddings: readonly (readonly number[])[],
  expectedCount: number,
  expectedDimensions = YC_EMBEDDING_DIMENSIONS,
) {
  if (embeddings.length !== expectedCount) {
    throw new Error(`Embedding API returned ${embeddings.length} vectors for ${expectedCount} YC companies.`);
  }
  for (let index = 0; index < embeddings.length; index += 1) {
    const embedding = embeddings[index];
    if (embedding.length !== expectedDimensions) {
      throw new Error(`YC embedding ${index} has ${embedding.length} dimensions; expected ${expectedDimensions}.`);
    }
    if (embedding.some((value) => !Number.isFinite(value))) {
      throw new Error(`YC embedding ${index} contains a non-finite value.`);
    }
  }
}

export function ycCompanySourceHash(company: YcCompanySourceRecord) {
  return createHash("sha256").update(JSON.stringify({
    id: company.id,
    name: company.name,
    slug: company.slug,
    formerNames: company.formerNames,
    website: company.website,
    batch: company.batch,
    year: company.year,
    industry: company.industry,
    subindustry: company.subindustry,
    oneLiner: company.oneLiner,
    longDescription: company.longDescription,
    tags: company.tags,
    regions: company.regions,
    location: company.location,
    operatingArea: company.operatingArea,
    targetMarket: company.targetMarket,
    aiLinked: company.aiLinked,
    hiring: company.hiring,
    logo: company.logo,
  })).digest("hex");
}

export function missingYcCompanies(
  companies: readonly YcCompanySourceRecord[],
  existingIds: ReadonlySet<number>,
) {
  return companies.filter((company) => !existingIds.has(company.id));
}

export function ycCompanyInsertStatement(
  company: YcCompanySourceRecord,
  embedding: readonly number[],
  embeddingModel: string,
  now: number,
): InStatement {
  return {
    sql: `INSERT OR IGNORE INTO yc_companies (
      id, name, slug, website, batch, year, industry, subindustry, one_liner,
      long_description, tags, search_text, source_hash, location, operating_area,
      target_market, ai_linked, hiring, logo, x, y, embedding, embedding_model,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, vector32(?), ?, ?, ?)`,
    args: [
      company.id,
      company.name,
      company.slug,
      company.website,
      company.batch,
      company.year,
      company.industry,
      company.subindustry,
      company.oneLiner,
      company.longDescription,
      JSON.stringify(company.tags),
      company.embeddingText,
      ycCompanySourceHash(company),
      company.location,
      company.operatingArea,
      company.targetMarket,
      company.aiLinked ? 1 : 0,
      company.hiring ? 1 : 0,
      company.logo,
      company.x,
      company.y,
      JSON.stringify(embedding),
      embeddingModel,
      now,
      now,
    ],
  };
}

export async function insertYcCompanyBatch(
  client: Client,
  companies: readonly YcCompanySourceRecord[],
  embeddings: readonly (readonly number[])[],
  embeddingModel: string,
  now: number,
) {
  validateYcEmbeddings(embeddings, companies.length);
  if (!companies.length) return;
  await client.batch(
    companies.map((company, index) => ycCompanyInsertStatement(company, embeddings[index], embeddingModel, now)),
    "write",
  );
}

async function existingYcState(client: Client) {
  try {
    const [companies, manifest] = await Promise.all([
      client.execute("SELECT id, embedding_model FROM yc_companies"),
      client.execute("SELECT embedding_model, embedding_dimensions FROM yc_dataset_manifest WHERE id = 1"),
    ]);
    return {
      ids: new Set(companies.rows.map((row) => Number(row.id))),
      rowEmbeddingModels: new Set(companies.rows.map((row) => String(row.embedding_model))),
      manifest: manifest.rows[0] ? {
        embeddingModel: String(manifest.rows[0].embedding_model),
        embeddingDimensions: Number(manifest.rows[0].embedding_dimensions),
      } : null,
    };
  } catch (error) {
    throw new Error("YC database tables are unavailable. Run `bun run db:migrate` against Turso before seeding.", { cause: error });
  }
}

export async function assertLibsqlVectorCapability(client: Client) {
  try {
    const result = await client.execute("SELECT length(vector32('[0,0]')) AS vector_bytes");
    if (Number(result.rows[0]?.vector_bytes) !== 8) throw new Error("unexpected vector byte length");
  } catch (error) {
    throw new Error("The configured Turso database does not support libSQL vector functions.", { cause: error });
  }
}

function assertEmbeddingCompatibility(
  state: Awaited<ReturnType<typeof existingYcState>>,
  embeddingModel: string,
) {
  const incompatibleRows = [...state.rowEmbeddingModels].filter((model) => model !== embeddingModel);
  if (incompatibleRows.length) {
    throw new Error(`Turso contains YC embeddings from ${incompatibleRows.join(", ")}; refusing to mix them with ${embeddingModel}.`);
  }
  if (state.manifest && (
    state.manifest.embeddingModel !== embeddingModel
    || state.manifest.embeddingDimensions !== YC_EMBEDDING_DIMENSIONS
  )) {
    throw new Error(
      `Turso YC manifest expects ${state.manifest.embeddingModel}/${state.manifest.embeddingDimensions}; `
      + `the seed command is configured for ${embeddingModel}/${YC_EMBEDDING_DIMENSIONS}.`,
    );
  }
}

async function updateYcManifest(client: Client, embeddingModel: string, now: Date) {
  const result = await client.execute({
    sql: "SELECT batch, industry FROM yc_companies WHERE year >= ? AND year <= ? ORDER BY id",
    args: [YC_FIRST_YEAR, currentUtcYear(now)],
  });
  const companies = result.rows.map((row) => ({
    batch: String(row.batch),
    industry: String(row.industry),
  }));
  const manifest = createYcDatasetManifest(companies, { generatedAt: now, source: YC_SOURCE_URL });
  await client.execute({
    sql: `INSERT INTO yc_dataset_manifest (
      id, version, source, generated_at, first_year, last_year, company_count,
      batches, industries, embedding_model, embedding_dimensions, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      version = excluded.version,
      source = excluded.source,
      generated_at = excluded.generated_at,
      first_year = excluded.first_year,
      last_year = excluded.last_year,
      company_count = excluded.company_count,
      batches = excluded.batches,
      industries = excluded.industries,
      embedding_model = excluded.embedding_model,
      embedding_dimensions = excluded.embedding_dimensions,
      updated_at = excluded.updated_at`,
    args: [
      manifest.version,
      manifest.source,
      manifest.generatedAt,
      manifest.firstYear,
      manifest.lastYear,
      manifest.companyCount,
      JSON.stringify(manifest.batches),
      JSON.stringify(manifest.industries),
      embeddingModel,
      YC_EMBEDDING_DIMENSIONS,
      now.getTime(),
    ],
  });
  return manifest;
}

export async function seedYcData(options: {
  environment?: Readonly<Record<string, string | undefined>>;
  mode?: "seed" | "sync";
  fetchImplementation?: typeof fetch;
  coordinatesPath?: string;
  now?: Date;
} = {}) {
  const environment = options.environment ?? process.env;
  const config = requireRemoteTursoEnvironment(environment);
  const now = options.now ?? new Date();
  const client = createClient({ url: config.databaseUrl, authToken: config.authToken });

  try {
    await assertLibsqlVectorCapability(client);
    const state = await existingYcState(client);
    assertEmbeddingCompatibility(state, config.embeddingModel);
    const loaded = await loadNormalizedYcCompanies({
      modelVersion: appConfig.modelVersion,
      coordinatesPath: options.coordinatesPath,
      fetchImplementation: options.fetchImplementation,
      lastYear: currentUtcYear(now),
    });
    if (!loaded.companies.length) throw new Error("YC source normalization returned no companies; refusing to update Turso.");
    const pending = missingYcCompanies(loaded.companies, state.ids);
    console.log(
      `${options.mode === "sync" ? "Syncing" : "Seeding"} ${pending.length.toLocaleString()} new YC companies `
      + `(${state.ids.size.toLocaleString()} existing IDs skipped).`,
    );

    for (let offset = 0; offset < pending.length; offset += config.embeddingBatchSize) {
      const companies = pending.slice(offset, offset + config.embeddingBatchSize);
      const result = await embedMany({
        model: config.embeddingModel,
        values: companies.map((company) => company.embeddingText),
        maxParallelCalls: config.embeddingParallelism,
      });
      await insertYcCompanyBatch(client, companies, result.embeddings, config.embeddingModel, now.getTime());
      console.log(`${Math.min(offset + companies.length, pending.length).toLocaleString()}/${pending.length.toLocaleString()} new companies embedded and inserted.`);
    }

    const afterResult = await client.execute("SELECT id FROM yc_companies");
    const idsAfter = new Set(afterResult.rows.map((row) => Number(row.id)));
    const missingIds = pending.filter((company) => !idsAfter.has(company.id)).map((company) => company.id);
    if (missingIds.length) {
      const sample = missingIds.slice(0, 10).join(", ");
      throw new Error(
        `${missingIds.length} YC companies were ignored by Turso and remain missing (IDs: ${sample}${missingIds.length > 10 ? ", …" : ""}). `
        + "Check unique slug conflicts before retrying.",
      );
    }
    const insertedCount = pending.filter((company) => !state.ids.has(company.id) && idsAfter.has(company.id)).length;
    const manifest = await updateYcManifest(client, config.embeddingModel, now);
    return {
      existingCount: state.ids.size,
      insertedCount,
      manifest,
      learnedCoordinateCount: loaded.learnedCoordinateCount,
    };
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  const mode = process.argv.includes("--sync") ? "sync" : "seed";
  const result = await seedYcData({ mode });
  console.log(
    `YC ${mode} complete: ${result.manifest.companyCount.toLocaleString()} total companies, `
    + `${result.insertedCount.toLocaleString()} inserted, manifest ${result.manifest.version}.`,
  );
}
