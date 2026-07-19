/// <reference lib="webworker" />

import { appConfig } from "@/config";
import { founderFeatureVector, hasFounderEvidence } from "@/lib/ml/founder-features";
import { downloadModelArchive, isFounderAwareManifest, type ModelArchive } from "@/lib/ml/model-archive";
import { blendFounderAwareScore } from "@/lib/ml/score";
import type { ApplicationProfile, PredictionResult } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

const context: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

type Neighbor = { id: number; distance: number };
type LocalInference = {
  score: number;
  startupFit: number;
  founderFit: number | null;
  startupWeight: number;
  founderWeight: number;
  neighbors: Neighbor[];
  founderAwareRelease: boolean;
};

function progress(stage: "loading" | "vectorizing" | "inference" | "neighbors", value: number, label: string) {
  context.postMessage({ type: "progress", value: { stage, progress: value, label } });
}

function tokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((token) => token.length > 2));
}

function jaccard(left: Set<string>, right: Set<string>) {
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function hashIndex(value: string, size: number) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}

function structuredFeatures(profile: ApplicationProfile) {
  const values = new Float32Array(32);
  for (const label of [profile.sector, profile.targetCustomer, profile.geography, profile.aiLinked ? "True" : "False", profile.businessModel, profile.productModality, profile.stage, profile.teamSizeBand]) {
    values[hashIndex(label, values.length)] += 1;
  }
  return values;
}

function normalizeFeatures(values: number[] | Float32Array, normalization: { mean: number[]; scale: number[] }) {
  return Float32Array.from(values, (value, index) => (value - normalization.mean[index]) / Math.max(normalization.scale[index], 1e-8));
}

function normalizeLatent(values: Float32Array) {
  const norm = Math.max(1e-8, Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)));
  return Float32Array.from(values, (value) => value / norm);
}

function calibrate(error: number, calibration: number[]) {
  const notBetter = calibration.filter((value) => value >= error).length;
  return Math.max(0, Math.min(100, Math.round(notBetter / calibration.length * 100)));
}

function reconstructionError(actual: Float32Array, reconstruction: Float32Array) {
  return actual.reduce((sum, value, index) => sum + (value - reconstruction[index]) ** 2, 0) / actual.length;
}

function squaredDistance(candidate: Float32Array, reference: Float32Array, referenceOffset: number, dimensions: number) {
  let distance = 0;
  for (let index = 0; index < dimensions; index += 1) {
    distance += (candidate[index] - reference[referenceOffset + index]) ** 2;
  }
  return distance;
}

async function legacyFitScore(profile: ApplicationProfile, archive: ModelArchive, embedding: number[], ort: typeof import("onnxruntime-web")): Promise<LocalInference> {
  const manifest = archive.manifest;
  if (isFounderAwareManifest(manifest) || Array.isArray(archive.calibration) === false || "startup" in archive.normalization) {
    throw new Error("MODEL_ARCHIVE_VERSION_MISMATCH");
  }
  const raw = [...embedding, ...structuredFeatures(profile)];
  if (raw.length !== manifest.featureDimensions) throw new Error("MODEL_FEATURE_DIMENSION_MISMATCH");
  const normalized = normalizeFeatures(raw, archive.normalization);
  const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
  const session = await ort.InferenceSession.create(archive.model, { executionProviders: providers as never });
  const output = await session.run({ features: new ort.Tensor("float32", normalized, [1, normalized.length]) });
  const reconstruction = output.reconstruction.data as Float32Array;
  const candidateLatent = output.latent.data as Float32Array;
  const startupFit = calibrate(reconstructionError(normalized, reconstruction), archive.calibration);
  const candidate = candidateLatent;
  const references = new Float32Array(archive.referenceLatent.buffer);
  if (candidate.length !== manifest.bottleneckDimensions || references.length !== archive.referenceIds.length * manifest.bottleneckDimensions) {
    throw new Error("MODEL_REFERENCE_DIMENSION_MISMATCH");
  }
  const neighbors = archive.referenceIds.map((id, companyIndex) => ({
    id,
    distance: squaredDistance(candidate, references, companyIndex * manifest.bottleneckDimensions, manifest.bottleneckDimensions),
  })).sort((left, right) => left.distance - right.distance).slice(0, 12);
  return { score: startupFit, startupFit, founderFit: null, startupWeight: 1, founderWeight: 0, neighbors, founderAwareRelease: false };
}

async function founderAwareFitScore(profile: ApplicationProfile, archive: ModelArchive, embedding: number[], ort: typeof import("onnxruntime-web")): Promise<LocalInference> {
  const manifest = archive.manifest;
  if (!isFounderAwareManifest(manifest) || Array.isArray(archive.calibration) || !("startup" in archive.normalization) || !archive.referenceFounderAvailability) {
    throw new Error("MODEL_ARCHIVE_VERSION_MISMATCH");
  }
  const startupRaw = [...embedding, ...structuredFeatures(profile)];
  const founderRaw = founderFeatureVector(profile.founderProfile);
  if (startupRaw.length !== manifest.startupFeatureDimensions || founderRaw.length !== manifest.founderFeatureDimensions) {
    throw new Error("MODEL_FEATURE_DIMENSION_MISMATCH");
  }
  const startupNormalized = normalizeFeatures(startupRaw, archive.normalization.startup);
  const founderAvailable = hasFounderEvidence(profile.founderProfile);
  const founderNormalized = founderAvailable
    ? normalizeFeatures(founderRaw, archive.normalization.founder)
    : new Float32Array(manifest.founderFeatureDimensions);
  const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
  const session = await ort.InferenceSession.create(archive.model, { executionProviders: providers as never });
  const output = await session.run({
    startup_features: new ort.Tensor("float32", startupNormalized, [1, startupNormalized.length]),
    founder_features: new ort.Tensor("float32", founderNormalized, [1, founderNormalized.length]),
  });
  const startupReconstruction = output.startup_reconstruction.data as Float32Array;
  const founderReconstruction = output.founder_reconstruction.data as Float32Array;
  const startupFit = calibrate(reconstructionError(startupNormalized, startupReconstruction), archive.calibration.startup);
  const founderFit = founderAvailable
    ? calibrate(reconstructionError(founderNormalized, founderReconstruction), archive.calibration.founder)
    : null;
  const blended = blendFounderAwareScore(startupFit, founderFit, manifest.scoreWeights.founder);
  const { score, startupWeight, founderWeight } = blended;

  const startupCandidate = normalizeLatent(output.startup_latent.data as Float32Array);
  const founderCandidate = normalizeLatent(output.founder_latent.data as Float32Array);
  const references = new Float32Array(archive.referenceLatent.buffer);
  if (startupCandidate.length !== manifest.startupBottleneckDimensions
    || founderCandidate.length !== manifest.founderBottleneckDimensions
    || references.length !== archive.referenceIds.length * manifest.referenceDimensions
    || archive.referenceFounderAvailability.length !== archive.referenceIds.length) {
    throw new Error("MODEL_REFERENCE_DIMENSION_MISMATCH");
  }
  const neighbors = archive.referenceIds.flatMap((id, companyIndex) => {
    if (founderAvailable && !archive.referenceFounderAvailability?.[companyIndex]) return [];
    const rowOffset = companyIndex * manifest.referenceDimensions;
    const startupDistance = squaredDistance(startupCandidate, references, rowOffset, manifest.startupBottleneckDimensions);
    const founderDistance = founderAvailable
      ? squaredDistance(founderCandidate, references, rowOffset + manifest.startupBottleneckDimensions, manifest.founderBottleneckDimensions)
      : 0;
    return [{ id, distance: founderAvailable ? startupDistance * startupWeight + founderDistance * founderWeight : startupDistance }];
  }).sort((left, right) => left.distance - right.distance).slice(0, 12);
  return { score, startupFit, founderFit, startupWeight, founderWeight, neighbors, founderAwareRelease: true };
}

async function onnxFitScore(profile: ApplicationProfile, archive: ModelArchive) {
  const [{ pipeline }, ort] = await Promise.all([
    import("@huggingface/transformers"),
    import("onnxruntime-web"),
  ]);
  progress("loading", 0.24, "Loading the quantized text encoder and ONNX scorer");
  const extractor = await pipeline("feature-extraction", archive.manifest.embeddingModel, { dtype: "q8" });
  const encoded = await extractor(`${profile.summary} Sector: ${profile.sector}. Customer: ${profile.targetCustomer}.`, { pooling: "mean", normalize: true });
  const embedding = Array.from(encoded.data as Float32Array);
  return isFounderAwareManifest(archive.manifest)
    ? founderAwareFitScore(profile, archive, embedding, ort)
    : legacyFitScore(profile, archive, embedding, ort);
}

context.onmessage = async (event: MessageEvent<{ profile: ApplicationProfile }>) => {
  try {
    progress("loading", 0.1, "Downloading the versioned model archive");
    const [companies, archive] = await Promise.all([
      fetch("/data/yc-companies.json").then((response) => response.json()) as Promise<YcCompany[]>,
      downloadModelArchive(appConfig.modelArchiveUrl),
    ]);
    progress("vectorizing", 0.38, "Vectorizing the application and founder profile locally");
    const { profile } = event.data;
    const profileTokens = tokens(`${profile.summary} ${profile.sector} ${profile.subindustry} ${profile.targetCustomer} ${profile.productModality}`);
    progress("inference", 0.64, "Running accepted-company fit inference");
    const localInference = await onnxFitScore(profile, archive);
    const lexicalRanked = companies.map((company) => {
      const lexical = jaccard(profileTokens, tokens(`${company.oneLiner} ${company.industry} ${company.subindustry} ${company.targetMarket}`));
      const sector = company.industry === profile.sector ? 0.35 : company.subindustry.toLowerCase().includes(profile.subindustry.toLowerCase()) ? 0.22 : 0;
      const market = company.targetMarket === profile.targetCustomer ? 0.2 : 0;
      const ai = company.aiLinked === profile.aiLinked ? 0.08 : 0;
      return { company, similarity: lexical * 0.37 + sector + market + ai };
    }).sort((a, b) => b.similarity - a.similarity);
    const companyLookup = new Map(companies.map((company) => [company.id, company]));
    const latentRanked = localInference.neighbors.flatMap((neighbor) => {
      const company = companyLookup.get(neighbor.id);
      return company ? [{ company, similarity: 1 / (1 + Math.sqrt(neighbor.distance)) }] : [];
    });
    const latentIds = new Set(latentRanked.map((item) => item.company.id));
    const ranked = [...latentRanked, ...lexicalRanked.filter((item) => !latentIds.has(item.company.id))].slice(0, 12);
    progress("neighbors", 0.86, "Positioning the company among its nearest analogs");
    const score = localInference.score;
    const weight = ranked.reduce((sum, item) => sum + Math.max(item.similarity, 0.01), 0) || 1;
    const clusterPoint = ranked.reduce((point, item) => ({
      x: point.x + item.company.x * Math.max(item.similarity, 0.01) / weight,
      y: point.y + item.company.y * Math.max(item.similarity, 0.01) / weight,
    }), { x: 0, y: 0 });
    const founderFactor = localInference.founderFit === null
      ? { label: "Founder alignment", value: "Not enough evidence", impact: "neutral" as const }
      : {
          label: "Founder alignment",
          value: `${localInference.founderFit}/100 · ${Math.round(localInference.founderWeight * 100)}% weight`,
          impact: localInference.founderFit >= 60 ? "positive" as const : localInference.founderFit < 40 ? "negative" as const : "neutral" as const,
        };
    const warnings = [
      "This fit score is not an acceptance probability.",
      ...(!localInference.founderAwareRelease ? ["Founder-aware scoring is unavailable in this legacy model release."] : []),
      ...(localInference.founderAwareRelease && localInference.founderFit === null ? ["Founder background was not evidenced; the overall score uses startup fit only. Add founder evidence to generate a founder-aware rescore."] : []),
    ];
    const result: PredictionResult = {
      scoreKind: "fit",
      score,
      band: score >= 75 ? "Strong fit" : score >= 50 ? "Promising" : "Early signal",
      coverage: profile.extractionCoverage >= 0.75 ? "high" : profile.extractionCoverage >= 0.5 ? "medium" : "low",
      reconstructionPercentile: score / 100,
      scoreComponents: {
        startupFit: localInference.startupFit,
        founderFit: localInference.founderFit,
        startupWeight: localInference.startupWeight,
        founderWeight: localInference.founderWeight,
      },
      nearestCompanyIds: ranked.map((item) => item.company.id),
      clusterPoint,
      factors: [
        { label: "Startup fit", value: `${localInference.startupFit}/100 · ${Math.round(localInference.startupWeight * 100)}% weight`, impact: localInference.startupFit >= 60 ? "positive" : localInference.startupFit < 40 ? "negative" : "neutral" },
        founderFactor,
        { label: "Evidence coverage", value: `${Math.round(profile.extractionCoverage * 100)}%`, impact: profile.extractionCoverage >= 0.75 ? "positive" : "negative" },
        { label: "Application completeness", value: `${profile.missingFields.length} key gaps`, impact: profile.missingFields.length <= 1 ? "positive" : profile.missingFields.length <= 3 ? "neutral" : "negative" },
      ],
      warnings,
      modelVersion: archive.manifest.version || appConfig.modelVersion,
      datasetVersion: archive.manifest.datasetVersion || appConfig.datasetVersion,
    };
    progress("neighbors", 1, "Local prediction complete");
    context.postMessage({ type: "result", value: result });
  } catch (error) {
    context.postMessage({ type: "error", error: error instanceof Error ? error.message : "Local model failed." });
  }
};

export {};
