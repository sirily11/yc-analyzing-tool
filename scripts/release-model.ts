import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type Transaction } from "@libsql/client";
import { zipSync } from "fflate";
import { appConfig } from "../config";

const baseReleaseFiles = [
  "model.onnx",
  "normalization.json",
  "calibration.json",
  "reference-latent.bin",
  "reference-ids.json",
  "evaluation.json",
  "manifest.json",
] as const;

type ReleaseManifest = {
  version: string;
  datasetVersion: string;
  trainingCompanies: number;
  founderFeatureDimensions?: number;
};

type S3Config = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
  prefix: string;
  downloadBaseUrl: string;
};

type S3Client = {
  write(key: string, data: Uint8Array, options?: { type?: string }): Promise<number>;
  stat(key: string): Promise<{ size: number }>;
};

type S3ClientConstructor = new (options: {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
}) => S3Client;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to release the model.`);
  return value;
}

function s3Config(): S3Config {
  return {
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    bucket: requiredEnv("S3_BUCKET"),
    endpoint: requiredEnv("S3_ENDPOINT").replace(/\/+$/, ""),
    region: requiredEnv("S3_REGION"),
    prefix: process.env.S3_PREFIX?.trim().replace(/^\/+|\/+$/g, "") ?? "",
    downloadBaseUrl: requiredEnv("S3_DOWNLOAD_BASE_URL").replace(/\/+$/, ""),
  };
}

export function modelObjectKey(prefix: string, releaseId: string, version: string) {
  return [prefix, `${releaseId}-${version}.zip`].filter(Boolean).join("/");
}

export function publicModelUrl(downloadBaseUrl: string, objectKey: string) {
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  return `${downloadBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
}

export function withModelArchiveUrl(configSource: string, archiveUrl: string) {
  const field = /(\bmodelArchiveUrl:\s*)("[^"]*"|'[^']*')/;
  if (!field.test(configSource)) throw new Error("modelArchiveUrl was not found in config.ts.");
  return configSource.replace(field, `$1${JSON.stringify(archiveUrl)}`);
}

export function withActiveModelConfig(configSource: string, release: { modelVersion: string; datasetVersion: string; archiveUrl: string }) {
  const replacements: Array<[RegExp, string, string]> = [
    [/(\bdatasetVersion:\s*)("[^"]*"|'[^']*')/, "datasetVersion", release.datasetVersion],
    [/(\bmodelVersion:\s*)("[^"]*"|'[^']*')/, "modelVersion", release.modelVersion],
    [/(\bmodelArchiveUrl:\s*)("[^"]*"|'[^']*')/, "modelArchiveUrl", release.archiveUrl],
  ];
  return replacements.reduce((source, [pattern, field, value]) => {
    if (!pattern.test(source)) throw new Error(`${field} was not found in config.ts.`);
    return source.replace(pattern, `$1${JSON.stringify(value)}`);
  }, configSource);
}

export type ModelDirectoryCoordinate = { id: number; x: number; y: number };

export function parseModelDirectoryCoordinates(directorySource: string, referenceIdsSource: string, trainingCompanies: number) {
  const directory = JSON.parse(directorySource) as unknown;
  const referenceIds = JSON.parse(referenceIdsSource) as unknown;
  if (!Array.isArray(directory) || !directory.length) throw new Error("The promoted model directory coordinates are empty or invalid.");
  if (!Array.isArray(referenceIds) || !referenceIds.length) throw new Error("The promoted model reference IDs are empty or invalid.");

  const ids = new Set<number>();
  const coordinates = directory.map((value, index): ModelDirectoryCoordinate => {
    if (!value || typeof value !== "object") throw new Error(`Model directory coordinate ${index} is invalid.`);
    const record = value as Record<string, unknown>;
    const id = record.id;
    const x = record.x;
    const y = record.y;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error(`Model directory coordinate ${index} has an invalid company ID.`);
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error(`Model directory coordinate ${index} is outside the normalized map bounds.`);
    }
    if (ids.has(Number(id))) throw new Error(`Model directory coordinates contain duplicate company ID ${id}.`);
    ids.add(Number(id));
    return { id: Number(id), x, y };
  });

  const expectedIds = referenceIds.map((value, index) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`Model reference ID ${index} is invalid.`);
    return value;
  });
  const expectedSet = new Set(expectedIds);
  if (expectedSet.size !== expectedIds.length) throw new Error("The promoted model reference IDs contain duplicates.");
  if (!Number.isSafeInteger(trainingCompanies) || trainingCompanies < 1 || coordinates.length !== trainingCompanies) {
    throw new Error("Model directory coordinate count does not match the promoted model manifest.");
  }
  if (coordinates.length !== expectedIds.length || coordinates.some((coordinate) => !expectedSet.has(coordinate.id))) {
    throw new Error("Model directory coordinate IDs do not exactly match the promoted reference IDs.");
  }
  return coordinates;
}

export async function applyModelDirectoryCoordinates(
  transaction: Pick<Transaction, "execute" | "batch">,
  coordinates: readonly ModelDirectoryCoordinate[],
  updatedAt = Date.now(),
) {
  const existing = await transaction.execute("SELECT id FROM yc_companies");
  const existingIds = new Set(existing.rows.map((row) => Number(row.id)));
  const missingIds = coordinates.filter((coordinate) => !existingIds.has(coordinate.id)).map((coordinate) => coordinate.id);
  if (missingIds.length) {
    throw new Error(
      `Turso is missing ${missingIds.length} model coordinate compan${missingIds.length === 1 ? "y" : "ies"} `
      + `(${missingIds.slice(0, 10).join(", ")}${missingIds.length > 10 ? ", …" : ""}). Run yc:sync before releasing the model.`,
    );
  }
  for (let offset = 0; offset < coordinates.length; offset += 100) {
    const batch = coordinates.slice(offset, offset + 100);
    const results = await transaction.batch(batch.map((coordinate) => ({
      sql: "UPDATE yc_companies SET x = ?, y = ?, updated_at = ? WHERE id = ?",
      args: [coordinate.x, coordinate.y, updatedAt, coordinate.id],
    })));
    if (results.some((result) => result.rowsAffected !== 1)) {
      throw new Error("Turso did not update every promoted model coordinate.");
    }
  }
  return coordinates.length;
}

export async function packageModelArchive(sourceDirectory: string, outputDirectory: string, releaseId: string) {
  const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8")) as ReleaseManifest;
  if (!manifest.version || !manifest.datasetVersion || !Number.isSafeInteger(manifest.trainingCompanies) || manifest.trainingCompanies < 1) {
    throw new Error("The promoted model manifest is missing valid version or training-company information.");
  }
  const releaseFiles = manifest.founderFeatureDimensions
    ? [...baseReleaseFiles, "reference-founder-availability.json"]
    : [...baseReleaseFiles];
  const entries: Record<string, Uint8Array> = {};
  for (const filename of releaseFiles) {
    entries[`${manifest.version}/${filename}`] = await readFile(path.join(sourceDirectory, filename));
  }

  const archive = zipSync(entries, { level: 6 });
  await mkdir(outputDirectory, { recursive: true });
  const archivePath = path.join(outputDirectory, `${releaseId}-${manifest.version}.zip`);
  await writeFile(archivePath, archive);
  return { archive, archivePath, manifest };
}

function requireReleaseTursoEnvironment(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const databaseUrl = environment.TURSO_DATABASE_URL?.trim() ?? "";
  if (!databaseUrl || databaseUrl === ":memory:" || /^file:/i.test(databaseUrl)) {
    throw new Error("A remote, non-file TURSO_DATABASE_URL is required to activate model coordinates.");
  }
  try {
    const url = new URL(databaseUrl);
    if (!["libsql:", "https:", "http:", "wss:", "ws:"].includes(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new Error("TURSO_DATABASE_URL must be a valid remote libSQL URL.");
  }
  const authToken = environment.TURSO_AUTH_TOKEN?.trim() ?? "";
  if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required to activate model coordinates.");
  return { databaseUrl, authToken };
}

async function activateModel(
  archiveUrl: string,
  manifest: ReleaseManifest,
  coordinates: readonly ModelDirectoryCoordinate[],
  turso: ReturnType<typeof requireReleaseTursoEnvironment>,
) {
  const configPath = path.join(process.cwd(), "config.ts");
  const [currentConfig, configStat] = await Promise.all([
    readFile(configPath, "utf8"),
    stat(configPath),
  ]);
  const nextConfig = withActiveModelConfig(currentConfig, {
    modelVersion: manifest.version,
    datasetVersion: manifest.datasetVersion,
    archiveUrl,
  });
  const temporaryConfig = path.join(process.cwd(), `.config.ts.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporaryConfig, nextConfig, { mode: configStat.mode });
  const ycClient = createClient({ url: turso.databaseUrl, authToken: turso.authToken });
  let transaction: Transaction | null = null;
  let configActivationStarted = false;
  try {
    transaction = await ycClient.transaction("write");
    const coordinateCount = await applyModelDirectoryCoordinates(transaction, coordinates);
    configActivationStarted = true;
    await rename(temporaryConfig, configPath);
    await transaction.commit();
    return coordinateCount;
  } catch (error) {
    await transaction?.rollback().catch(() => undefined);
    if (configActivationStarted) await writeFile(configPath, currentConfig, { mode: configStat.mode });
    throw error;
  } finally {
    transaction?.close();
    ycClient.close();
    await unlink(temporaryConfig).catch(() => undefined);
  }
}

function createS3Client(config: S3Config) {
  const constructor = (globalThis as typeof globalThis & {
    Bun?: { S3Client?: S3ClientConstructor };
  }).Bun?.S3Client;
  if (!constructor) throw new Error("The Bun S3 client is unavailable. Run this script with Bun.");
  return new constructor(config);
}

export async function releaseModel({ dryRun = false, modelVersion = appConfig.modelVersion }: { dryRun?: boolean; modelVersion?: string } = {}) {
  const releaseId = randomUUID();
  const sourceDirectory = path.join(process.cwd(), "public", "models", modelVersion);
  const outputDirectory = path.join(process.cwd(), "ml", "releases");
  const { archive, archivePath, manifest } = await packageModelArchive(sourceDirectory, outputDirectory, releaseId);
  if (manifest.version !== modelVersion) throw new Error(`Promoted manifest version ${manifest.version} does not match requested model ${modelVersion}.`);
  const [directorySource, referenceIdsSource] = await Promise.all([
    readFile(path.join(sourceDirectory, "directory-companies.json"), "utf8"),
    readFile(path.join(sourceDirectory, "reference-ids.json"), "utf8"),
  ]);
  const coordinates = parseModelDirectoryCoordinates(directorySource, referenceIdsSource, manifest.trainingCompanies);
  const sha256 = createHash("sha256").update(archive).digest("hex");

  console.log(`Packaged ${path.relative(process.cwd(), archivePath)} (${archive.byteLength.toLocaleString()} bytes).`);
  console.log(`SHA-256: ${sha256}`);
  if (dryRun) {
    console.log("Dry run complete; S3 upload, Turso coordinate activation, and config.ts update were skipped.");
    return { archivePath, releaseId, sha256, archiveUrl: null };
  }

  const config = s3Config();
  const turso = requireReleaseTursoEnvironment();
  const objectKey = modelObjectKey(config.prefix, releaseId, manifest.version);
  const client = createS3Client(config);
  await client.write(objectKey, archive, { type: "application/zip" });
  const uploaded = await client.stat(objectKey);
  if (uploaded.size !== archive.byteLength) {
    throw new Error(`S3 upload size mismatch: expected ${archive.byteLength}, received ${uploaded.size}.`);
  }

  const archiveUrl = publicModelUrl(config.downloadBaseUrl, objectKey);
  const coordinateCount = await activateModel(archiveUrl, manifest, coordinates, turso);
  console.log(`Uploaded s3://${config.bucket}/${objectKey}.`);
  console.log(`Activated ${manifest.version} (${manifest.datasetVersion}) at ${archiveUrl} with ${coordinateCount.toLocaleString()} Turso coordinates.`);
  return { archivePath, releaseId, sha256, archiveUrl };
}

if (import.meta.main) {
  const versionIndex = process.argv.indexOf("--model-version");
  const modelVersion = versionIndex >= 0 ? process.argv[versionIndex + 1] : appConfig.modelVersion;
  if (!modelVersion) throw new Error("--model-version requires a value.");
  await releaseModel({ dryRun: process.argv.includes("--dry-run"), modelVersion });
}
