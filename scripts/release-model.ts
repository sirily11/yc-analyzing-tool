import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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

export function withDatasetManifestVersion(source: string, datasetVersion: string) {
  const manifest = JSON.parse(source) as Record<string, unknown>;
  manifest.version = datasetVersion;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function packageModelArchive(sourceDirectory: string, outputDirectory: string, releaseId: string) {
  const manifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8")) as ReleaseManifest;
  if (!manifest.version || !manifest.datasetVersion) throw new Error("The promoted model manifest is missing version information.");
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

async function activateModel(sourceDirectory: string, archiveUrl: string, manifest: ReleaseManifest) {
  const configPath = path.join(process.cwd(), "config.ts");
  const dataPath = path.join(process.cwd(), "public/data/yc-companies.json");
  const datasetManifestPath = path.join(process.cwd(), "public/data/manifest.json");
  const [currentConfig, currentData, currentDatasetManifest, nextData, configStat, dataStat, manifestStat] = await Promise.all([
    readFile(configPath, "utf8"),
    readFile(dataPath),
    readFile(datasetManifestPath, "utf8"),
    readFile(path.join(sourceDirectory, "directory-companies.json")),
    stat(configPath),
    stat(dataPath),
    stat(datasetManifestPath),
  ]);
  const nextConfig = withActiveModelConfig(currentConfig, {
    modelVersion: manifest.version,
    datasetVersion: manifest.datasetVersion,
    archiveUrl,
  });
  const nextDatasetManifest = withDatasetManifestVersion(currentDatasetManifest, manifest.datasetVersion);
  const temporaryConfig = path.join(process.cwd(), `.config.ts.${process.pid}.${randomUUID()}.tmp`);
  const temporaryData = path.join(process.cwd(), `public/data/.yc-companies.${process.pid}.${randomUUID()}.tmp`);
  const temporaryManifest = path.join(process.cwd(), `public/data/.manifest.${process.pid}.${randomUUID()}.tmp`);
  await Promise.all([
    writeFile(temporaryConfig, nextConfig, { mode: configStat.mode }),
    writeFile(temporaryData, nextData, { mode: dataStat.mode }),
    writeFile(temporaryManifest, nextDatasetManifest, { mode: manifestStat.mode }),
  ]);
  try {
    await rename(temporaryData, dataPath);
    await rename(temporaryManifest, datasetManifestPath);
    await rename(temporaryConfig, configPath);
  } catch (error) {
    await Promise.all([
      writeFile(configPath, currentConfig, { mode: configStat.mode }),
      writeFile(dataPath, currentData, { mode: dataStat.mode }),
      writeFile(datasetManifestPath, currentDatasetManifest, { mode: manifestStat.mode }),
    ]);
    throw error;
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
  const sha256 = createHash("sha256").update(archive).digest("hex");

  console.log(`Packaged ${path.relative(process.cwd(), archivePath)} (${archive.byteLength.toLocaleString()} bytes).`);
  console.log(`SHA-256: ${sha256}`);
  if (dryRun) {
    console.log("Dry run complete; S3 upload and config.ts update were skipped.");
    return { archivePath, releaseId, sha256, archiveUrl: null };
  }

  const config = s3Config();
  const objectKey = modelObjectKey(config.prefix, releaseId, manifest.version);
  const client = createS3Client(config);
  await client.write(objectKey, archive, { type: "application/zip" });
  const uploaded = await client.stat(objectKey);
  if (uploaded.size !== archive.byteLength) {
    throw new Error(`S3 upload size mismatch: expected ${archive.byteLength}, received ${uploaded.size}.`);
  }

  const archiveUrl = publicModelUrl(config.downloadBaseUrl, objectKey);
  await activateModel(sourceDirectory, archiveUrl, manifest);
  console.log(`Uploaded s3://${config.bucket}/${objectKey}.`);
  console.log(`Activated ${manifest.version} (${manifest.datasetVersion}) at ${archiveUrl}.`);
  return { archivePath, releaseId, sha256, archiveUrl };
}

if (import.meta.main) {
  const versionIndex = process.argv.indexOf("--model-version");
  const modelVersion = versionIndex >= 0 ? process.argv[versionIndex + 1] : appConfig.modelVersion;
  if (!modelVersion) throw new Error("--model-version requires a value.");
  await releaseModel({ dryRun: process.argv.includes("--dry-run"), modelVersion });
}
