import { unzipSync } from "fflate";

export type ModelManifest = {
  version: string;
  datasetVersion: string;
  runtime: string;
  embeddingModel: string;
  featureDimensions: number;
  bottleneckDimensions: number;
};

export type ModelArchive = {
  manifest: ModelManifest;
  model: Uint8Array;
  normalization: { mean: number[]; scale: number[] };
  calibration: number[];
  referenceLatent: Uint8Array;
  referenceIds: number[];
};

const requiredFiles = [
  "manifest.json",
  "model.onnx",
  "normalization.json",
  "calibration.json",
  "reference-latent.bin",
  "reference-ids.json",
] as const;

function archiveFile(entries: Record<string, Uint8Array>, filename: string) {
  const matches = Object.entries(entries).filter(([path]) => path.split("/").at(-1) === filename);
  if (matches.length !== 1) throw new Error(`MODEL_ARCHIVE_INVALID:${filename}`);
  return matches[0][1];
}

function jsonFile<T>(entries: Record<string, Uint8Array>, filename: string): T {
  return JSON.parse(new TextDecoder().decode(archiveFile(entries, filename))) as T;
}

export function parseModelArchive(bytes: Uint8Array): ModelArchive {
  const entries = unzipSync(bytes);
  for (const filename of requiredFiles) archiveFile(entries, filename);

  const manifest = jsonFile<ModelManifest>(entries, "manifest.json");
  if (manifest.runtime !== "onnx") throw new Error("MODEL_ARCHIVE_RUNTIME_UNSUPPORTED");

  const referenceLatent = archiveFile(entries, "reference-latent.bin");
  if (referenceLatent.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("MODEL_ARCHIVE_REFERENCE_LATENT_INVALID");
  }

  return {
    manifest,
    model: Uint8Array.from(archiveFile(entries, "model.onnx")),
    normalization: jsonFile(entries, "normalization.json"),
    calibration: jsonFile(entries, "calibration.json"),
    referenceLatent: Uint8Array.from(referenceLatent),
    referenceIds: jsonFile(entries, "reference-ids.json"),
  };
}

export async function downloadModelArchive(url: string): Promise<ModelArchive> {
  if (!url) throw new Error("MODEL_ARCHIVE_URL_NOT_CONFIGURED");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MODEL_ARCHIVE_DOWNLOAD_FAILED:${response.status}`);
  return parseModelArchive(new Uint8Array(await response.arrayBuffer()));
}
