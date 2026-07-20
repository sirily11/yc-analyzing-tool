import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { normalizeYcCompanies } from "@/lib/yc/source";
import { exportYcData, requireYcExportEnvironment } from "@/scripts/export-yc-data";
import {
  assertLibsqlVectorCapability,
  insertYcCompanyBatch,
  missingYcCompanies,
  requireRemoteTursoEnvironment,
  validateYcEmbeddings,
  ycCompanySourceHash,
  YC_EMBEDDING_DIMENSIONS,
} from "@/scripts/seed-yc-data";

const remoteEnvironment = {
  TURSO_DATABASE_URL: "libsql://yc-example.turso.io",
  TURSO_AUTH_TOKEN: "test-token",
  AI_GATEWAY_API_KEY: "test-ai-key",
};

function normalizedCompany() {
  return normalizeYcCompanies([{
    id: 42,
    name: "Semantic Co",
    slug: "semantic-co",
    website: "https://semantic.example",
    batch: "Fall 2026",
    industry: "B2B",
    subindustry: "Analytics",
    one_liner: "Ask natural-language questions about operations",
    long_description: "Semantic search for business teams.",
    all_locations: "New York, NY, USA",
    regions: ["United States of America"],
    tags: ["Analytics"],
    isHiring: true,
  }], { lastYear: 2026 })[0];
}

async function createYcTables() {
  const client = createClient({ url: ":memory:" });
  await client.execute(`CREATE TABLE yc_companies (
    id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
    website TEXT, batch TEXT NOT NULL, year INTEGER NOT NULL, industry TEXT NOT NULL,
    subindustry TEXT NOT NULL, one_liner TEXT NOT NULL, long_description TEXT NOT NULL,
    tags TEXT NOT NULL, search_text TEXT NOT NULL, source_hash TEXT NOT NULL,
    location TEXT NOT NULL, operating_area TEXT NOT NULL, target_market TEXT NOT NULL,
    ai_linked INTEGER NOT NULL, hiring INTEGER NOT NULL, logo TEXT, x REAL NOT NULL,
    y REAL NOT NULL, embedding F32_BLOB(1536) NOT NULL, embedding_model TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    CHECK(typeof(embedding) = 'blob' AND length(embedding) = 6144)
  )`);
  await client.execute(`CREATE TABLE yc_dataset_manifest (
    id INTEGER PRIMARY KEY NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL,
    generated_at TEXT NOT NULL, first_year INTEGER NOT NULL, last_year INTEGER NOT NULL,
    company_count INTEGER NOT NULL, batches TEXT NOT NULL, industries TEXT NOT NULL,
    embedding_model TEXT NOT NULL, embedding_dimensions INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`);
  return client;
}

describe("YC Turso seeding", () => {
  it("requires remote Turso and embedding credentials before doing work", () => {
    expect(() => requireRemoteTursoEnvironment({
      ...remoteEnvironment,
      TURSO_DATABASE_URL: "file:local.db",
    })).toThrow("remote, non-file TURSO_DATABASE_URL");
    expect(() => requireRemoteTursoEnvironment({
      ...remoteEnvironment,
      AI_GATEWAY_API_KEY: "",
    })).toThrow("AI_GATEWAY_API_KEY");
    expect(requireRemoteTursoEnvironment(remoteEnvironment)).toMatchObject({
      embeddingModel: "openai/text-embedding-3-small",
      embeddingBatchSize: 64,
    });
    expect(requireYcExportEnvironment(remoteEnvironment)).toEqual({
      databaseUrl: remoteEnvironment.TURSO_DATABASE_URL,
      authToken: remoteEnvironment.TURSO_AUTH_TOKEN,
    });
  });

  it("rejects wrong-size and non-finite vectors", () => {
    expect(() => validateYcEmbeddings([[1, 2]], 1)).toThrow("expected 1536");
    const invalid = Array.from({ length: YC_EMBEDDING_DIMENSIONS }, () => 0);
    invalid[10] = Number.NaN;
    expect(() => validateYcEmbeddings([invalid], 1)).toThrow("non-finite");
  });

  it("selects only stable IDs that are not already in Turso", () => {
    const company = normalizedCompany();
    const next = { ...company, id: 43, slug: "next-company" };
    expect(missingYcCompanies([company, next], new Set([company.id]))).toEqual([next]);
  });

  it("inserts vector rows in an in-memory libSQL database with stable source hashes", async () => {
    const client = await createYcTables();
    try {
      await assertLibsqlVectorCapability(client);
      const company = normalizedCompany();
      const embedding = Array.from({ length: YC_EMBEDDING_DIMENSIONS }, (_, index) => index / YC_EMBEDDING_DIMENSIONS);
      await insertYcCompanyBatch(client, [company], [embedding], "openai/text-embedding-3-small", 1_000);
      const result = await client.execute("SELECT id, source_hash, length(embedding) AS bytes, vector_extract(embedding) AS vector FROM yc_companies");
      expect(result.rows[0]).toMatchObject({
        id: 42,
        source_hash: ycCompanySourceHash(company),
        bytes: YC_EMBEDDING_DIMENSIONS * 4,
      });
      expect(ycCompanySourceHash({ ...company, x: 0.01, y: 0.99 })).toBe(ycCompanySourceHash(company));
      expect(JSON.parse(String(result.rows[0].vector))).toHaveLength(YC_EMBEDDING_DIMENSIONS);
    } finally {
      client.close();
    }
  });

  it("allows a new stable ID to reuse a mutable upstream slug", async () => {
    const client = await createYcTables();
    try {
      const first = normalizedCompany();
      const second = { ...first, id: 43, name: "Semantic Co Next" };
      const embedding = Array.from({ length: YC_EMBEDDING_DIMENSIONS }, () => 0);
      await insertYcCompanyBatch(
        client,
        [first, second],
        [embedding, embedding],
        "openai/text-embedding-3-small",
        1_000,
      );
      const result = await client.execute("SELECT id FROM yc_companies ORDER BY id");
      expect(result.rows.map((row) => Number(row.id))).toEqual([42, 43]);
    } finally {
      client.close();
    }
  });

  it("exports the compact offline files from Turso instead of refetching upstream", async () => {
    const client = await createYcTables();
    const outputDirectory = await mkdtemp(path.join(tmpdir(), "yc-export-test-"));
    try {
      const company = normalizedCompany();
      const embedding = Array.from({ length: YC_EMBEDDING_DIMENSIONS }, () => 0);
      await insertYcCompanyBatch(client, [company], [embedding], "openai/text-embedding-3-small", 1_000);
      await client.execute({
        sql: `INSERT INTO yc_dataset_manifest (
          id, version, source, generated_at, first_year, last_year, company_count,
          batches, industries, embedding_model, embedding_dimensions, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "yc-2020-2026-ytd-v3",
          "https://yc-oss.github.io/api/companies/all.json",
          "2026-07-20T00:00:00.000Z",
          2020,
          2026,
          1,
          JSON.stringify(["Fall 2026"]),
          JSON.stringify(["B2B"]),
          "openai/text-embedding-3-small",
          YC_EMBEDDING_DIMENSIONS,
          1_000,
        ],
      });

      const result = await exportYcData({ client, outputDirectory });
      const companies = JSON.parse(await readFile(path.join(outputDirectory, "yc-companies.json"), "utf8"));
      const manifest = JSON.parse(await readFile(path.join(outputDirectory, "manifest.json"), "utf8"));
      expect(result.companyCount).toBe(1);
      expect(companies).toEqual([expect.objectContaining({ id: 42, oneLiner: company.oneLiner })]);
      expect(companies[0]).not.toHaveProperty("embedding");
      expect(companies[0]).not.toHaveProperty("longDescription");
      expect(manifest.version).toBe("yc-2020-2026-ytd-v3");
    } finally {
      client.close();
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
