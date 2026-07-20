import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import type { DatasetManifest, YcCompany } from "../lib/types/company";
import { loadLearnedCoordinates } from "./yc-data-source";

export function requireYcExportEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const databaseUrl = environment.TURSO_DATABASE_URL?.trim() ?? "";
  if (!databaseUrl || databaseUrl === ":memory:" || /^file:/i.test(databaseUrl)) {
    throw new Error("yc:export requires a remote, non-file TURSO_DATABASE_URL.");
  }
  try {
    const url = new URL(databaseUrl);
    if (!["libsql:", "https:", "http:", "wss:", "ws:"].includes(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new Error("TURSO_DATABASE_URL must be a valid remote libSQL URL.");
  }
  const authToken = environment.TURSO_AUTH_TOKEN?.trim() ?? "";
  if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required for yc:export.");
  return { databaseUrl, authToken };
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function parseJsonStrings(value: unknown, label: string) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error("not a string array");
    return parsed as string[];
  } catch (error) {
    throw new Error(`Turso YC manifest has invalid ${label} JSON.`, { cause: error });
  }
}

async function readYcExport(client: Client) {
  const [companyResult, manifestResult] = await Promise.all([
    client.execute(`SELECT
      id, name, slug, website, batch, year, industry, subindustry, one_liner,
      location, operating_area, target_market, ai_linked, hiring, logo, x, y
    FROM yc_companies
    ORDER BY year DESC, name ASC, id ASC`),
    client.execute("SELECT * FROM yc_dataset_manifest WHERE id = 1"),
  ]);
  const manifestRow = manifestResult.rows[0];
  if (!manifestRow) throw new Error("Turso does not have a YC dataset manifest. Run `bun run yc:seed` first.");
  const companies: YcCompany[] = companyResult.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    website: nullableString(row.website),
    batch: String(row.batch),
    year: Number(row.year),
    industry: String(row.industry),
    subindustry: String(row.subindustry),
    oneLiner: String(row.one_liner),
    location: String(row.location),
    operatingArea: String(row.operating_area),
    targetMarket: String(row.target_market),
    aiLinked: Number(row.ai_linked) !== 0,
    hiring: Number(row.hiring) !== 0,
    logo: nullableString(row.logo),
    x: Number(row.x),
    y: Number(row.y),
  }));
  const manifest: DatasetManifest = {
    version: String(manifestRow.version),
    source: String(manifestRow.source),
    generatedAt: String(manifestRow.generated_at),
    firstYear: Number(manifestRow.first_year),
    lastYear: Number(manifestRow.last_year),
    companyCount: Number(manifestRow.company_count),
    batches: parseJsonStrings(manifestRow.batches, "batches"),
    industries: parseJsonStrings(manifestRow.industries, "industries"),
  };
  if (manifest.companyCount !== companies.length) {
    throw new Error(`Turso YC manifest reports ${manifest.companyCount} companies but the table contains ${companies.length}.`);
  }
  return { companies, manifest };
}

export async function exportYcData(options: {
  outputDirectory?: string;
  coordinatesPath?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  client?: Client;
} = {}) {
  const ownedClient = !options.client;
  const client = options.client ?? (() => {
    const config = requireYcExportEnvironment(options.environment);
    return createClient({ url: config.databaseUrl, authToken: config.authToken });
  })();
  try {
    const exported = await readYcExport(client);
    let learnedCoordinateCount = 0;
    if (options.coordinatesPath) {
      const learned = await loadLearnedCoordinates("unused", options.coordinatesPath);
      for (const company of exported.companies) {
        const coordinate = learned.coordinates.get(company.id);
        if (coordinate) {
          company.x = coordinate.x;
          company.y = coordinate.y;
          learnedCoordinateCount += 1;
        }
      }
    }
    const target = options.outputDirectory ?? path.join(process.cwd(), "public", "data");
    await mkdir(target, { recursive: true });
    await Promise.all([
      writeFile(path.join(target, "yc-companies.json"), JSON.stringify(exported.companies)),
      writeFile(path.join(target, "manifest.json"), JSON.stringify(exported.manifest, null, 2)),
    ]);
    return {
      companyCount: exported.companies.length,
      manifest: exported.manifest,
      learnedCoordinateCount,
      coordinatesPath: options.coordinatesPath ?? null,
      outputDirectory: target,
    };
  } finally {
    if (ownedClient) client.close();
  }
}

if (import.meta.main) {
  const result = await exportYcData();
  const coordinateSummary = result.coordinatesPath
    ? `${result.learnedCoordinateCount.toLocaleString()} learned coordinates from ${result.coordinatesPath}`
    : "stored Turso coordinates";
  console.log(`Exported ${result.companyCount.toLocaleString()} YC companies to ${result.outputDirectory} using ${coordinateSummary}.`);
}
