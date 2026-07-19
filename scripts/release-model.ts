import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { appConfig } from "../config";

const releaseFiles = [
  "model.onnx",
  "normalization.json",
  "calibration.json",
  "reference-latent.bin",
  "reference-ids.json",
  "evaluation.json",
  "manifest.json",
] as const;

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

export async function packageModelArchive(sourceDirectory: string, outputDirectory: string, releaseId: string) {
  const entries: Record<string, Uint8Array> = {};
  for (const filename of releaseFiles) {
    entries[`${appConfig.modelVersion}/${filename}`] = await readFile(path.join(sourceDirectory, filename));
  }

  const archive = zipSync(entries, { level: 6 });
  await mkdir(outputDirectory, { recursive: true });
  const archivePath = path.join(outputDirectory, `${releaseId}-${appConfig.modelVersion}.zip`);
  await writeFile(archivePath, archive);
  return { archive, archivePath };
}

async function updateConfig(archiveUrl: string) {
  const configPath = path.join(process.cwd(), "config.ts");
  const current = await readFile(configPath, "utf8");
  const updated = withModelArchiveUrl(current, archiveUrl);
  const currentStat = await stat(configPath);
  const temporaryPath = path.join(process.cwd(), `.config.ts.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, updated, { mode: currentStat.mode });
  await rename(temporaryPath, configPath);
}

function createS3Client(config: S3Config) {
  const constructor = (globalThis as typeof globalThis & {
    Bun?: { S3Client?: S3ClientConstructor };
  }).Bun?.S3Client;
  if (!constructor) throw new Error("The Bun S3 client is unavailable. Run this script with Bun.");
  return new constructor(config);
}

export async function releaseModel({ dryRun = false }: { dryRun?: boolean } = {}) {
  const releaseId = randomUUID();
  const sourceDirectory = path.join(process.cwd(), "public", "models", appConfig.modelVersion);
  const outputDirectory = path.join(process.cwd(), "ml", "releases");
  const { archive, archivePath } = await packageModelArchive(sourceDirectory, outputDirectory, releaseId);
  const sha256 = createHash("sha256").update(archive).digest("hex");

  console.log(`Packaged ${path.relative(process.cwd(), archivePath)} (${archive.byteLength.toLocaleString()} bytes).`);
  console.log(`SHA-256: ${sha256}`);
  if (dryRun) {
    console.log("Dry run complete; S3 upload and config.ts update were skipped.");
    return { archivePath, releaseId, sha256, archiveUrl: null };
  }

  const config = s3Config();
  const objectKey = modelObjectKey(config.prefix, releaseId, appConfig.modelVersion);
  const client = createS3Client(config);
  await client.write(objectKey, archive, { type: "application/zip" });
  const uploaded = await client.stat(objectKey);
  if (uploaded.size !== archive.byteLength) {
    throw new Error(`S3 upload size mismatch: expected ${archive.byteLength}, received ${uploaded.size}.`);
  }

  const archiveUrl = publicModelUrl(config.downloadBaseUrl, objectKey);
  await updateConfig(archiveUrl);
  console.log(`Uploaded s3://${config.bucket}/${objectKey}.`);
  console.log(`Updated config.ts modelArchiveUrl to ${archiveUrl}.`);
  return { archivePath, releaseId, sha256, archiveUrl };
}

if (import.meta.main) {
  await releaseModel({ dryRun: process.argv.includes("--dry-run") });
}
