/// <reference lib="webworker" />

import { appConfig } from "@/config";
import { downloadModelArchive, type ModelArchive } from "@/lib/ml/model-archive";
import type { ApplicationProfile, PredictionResult } from "@/lib/types/analysis";
import type { YcCompany } from "@/lib/types/company";

const context: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function progress(stage: "loading" | "vectorizing" | "inference" | "neighbors", value: number, label: string) {
  context.postMessage({ type: "progress", value: { stage, progress: value, label } });
}

function tokens(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((token) => token.length > 2));
}

function jaccard(left: Set<string>, right: Set<string>) {
  let intersection = 0; for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function hashIndex(value: string, size: number) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % size;
}

function structuredFeatures(profile: ApplicationProfile) {
  const values = new Float32Array(32);
  for (const label of [profile.sector, profile.targetCustomer, profile.geography, profile.aiLinked ? "True" : "False", profile.businessModel, profile.productModality, profile.stage, profile.teamSizeBand]) values[hashIndex(label, values.length)] += 1;
  return values;
}

async function onnxFitScore(profile: ApplicationProfile, archive: ModelArchive) {
  const { manifest, model, normalization, calibration, referenceLatent, referenceIds } = archive;
  const [{ pipeline }, ort] = await Promise.all([
    import("@huggingface/transformers"),
    import("onnxruntime-web"),
  ]);
  progress("loading", 0.24, "Loading the quantized text encoder and ONNX scorer");
  const extractor = await pipeline("feature-extraction", manifest.embeddingModel, { dtype: "q8" });
  const encoded = await extractor(`${profile.summary} Sector: ${profile.sector}. Customer: ${profile.targetCustomer}.`, { pooling: "mean", normalize: true });
  const embedding = Array.from(encoded.data as Float32Array);
  const structured = Array.from(structuredFeatures(profile));
  const raw = [...embedding, ...structured];
  if (raw.length !== manifest.featureDimensions) throw new Error("MODEL_FEATURE_DIMENSION_MISMATCH");
  const normalized = Float32Array.from(raw.map((value, index) => (value - normalization.mean[index]) / Math.max(normalization.scale[index], 1e-8)));
  const providers = "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
  const session = await ort.InferenceSession.create(model, { executionProviders: providers as never });
  const output = await session.run({ features: new ort.Tensor("float32", normalized, [1, normalized.length]) });
  const reconstruction = output.reconstruction.data as Float32Array;
  const candidateLatent = output.latent.data as Float32Array;
  const error = normalized.reduce((sum, value, index) => sum + (value - reconstruction[index]) ** 2, 0) / normalized.length;
  const notBetter = calibration.filter((value) => value >= error).length;
  const referenceVectors = new Float32Array(referenceLatent.buffer);
  if (candidateLatent.length !== manifest.bottleneckDimensions || referenceVectors.length !== referenceIds.length * manifest.bottleneckDimensions) throw new Error("MODEL_REFERENCE_DIMENSION_MISMATCH");
  const neighbors = referenceIds.map((id, companyIndex) => {
    let distance = 0;
    const offset = companyIndex * manifest.bottleneckDimensions;
    for (let index = 0; index < manifest.bottleneckDimensions; index += 1) distance += (candidateLatent[index] - referenceVectors[offset + index]) ** 2;
    return { id, distance };
  }).sort((left, right) => left.distance - right.distance).slice(0, 12);
  return { score: Math.max(0, Math.min(100, Math.round(notBetter / calibration.length * 100))), neighbors };
}

context.onmessage = async (event: MessageEvent<{ profile: ApplicationProfile }>) => {
  try {
    progress("loading", 0.1, "Downloading the versioned model archive");
    const [companies, archive] = await Promise.all([
      fetch("/data/yc-companies.json").then((response) => response.json()) as Promise<YcCompany[]>,
      downloadModelArchive(appConfig.modelArchiveUrl),
    ]);
    const { manifest } = archive;
    progress("vectorizing", 0.38, "Vectorizing the application profile locally");
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
    }).sort((a, b) => b.similarity - a.similarity).slice(0, 12);
    const companyLookup = new Map(companies.map((company) => [company.id, company]));
    const latentRanked = localInference?.neighbors.flatMap((neighbor) => {
      const company = companyLookup.get(neighbor.id);
      return company ? [{ company, similarity: 1 / (1 + Math.sqrt(neighbor.distance)) }] : [];
    });
    const ranked = latentRanked?.length === 12 ? latentRanked : lexicalRanked;
    progress("neighbors", 0.86, "Positioning the company among its nearest analogs");
    const averageSimilarity = ranked.reduce((sum, item) => sum + item.similarity, 0) / Math.max(1, ranked.length);
    const completeness = Math.max(0, 1 - profile.missingFields.length / 8);
    const onnxScore = localInference?.score ?? null;
    const score = onnxScore ?? Math.max(8, Math.min(94, Math.round(24 + profile.extractionCoverage * 28 + completeness * 21 + averageSimilarity * 34)));
    const weight = ranked.reduce((sum, item) => sum + Math.max(item.similarity, 0.01), 0) || 1;
    const clusterPoint = ranked.reduce((point, item) => ({ x: point.x + item.company.x * Math.max(item.similarity, 0.01) / weight, y: point.y + item.company.y * Math.max(item.similarity, 0.01) / weight }), { x: 0, y: 0 });
    const result: PredictionResult = {
      scoreKind: "fit",
      score,
      band: score >= 75 ? "Strong fit" : score >= 50 ? "Promising" : "Early signal",
      coverage: profile.extractionCoverage >= 0.75 ? "high" : profile.extractionCoverage >= 0.5 ? "medium" : "low",
      reconstructionPercentile: score / 100,
      nearestCompanyIds: ranked.map((item) => item.company.id),
      clusterPoint,
      factors: [
        { label: "Sector alignment", value: profile.sector, impact: ranked[0]?.company.industry === profile.sector ? "positive" : "neutral" },
        { label: "Evidence coverage", value: `${Math.round(profile.extractionCoverage * 100)}%`, impact: profile.extractionCoverage >= 0.75 ? "positive" : "negative" },
        { label: "Application completeness", value: `${profile.missingFields.length} key gaps`, impact: profile.missingFields.length <= 1 ? "positive" : profile.missingFields.length <= 3 ? "neutral" : "negative" },
      ],
      warnings: ["This fit score is not an acceptance probability.", ...(onnxScore === null ? ["The bundled deterministic scorer is used until a validated ONNX artifact is released."] : [])],
      modelVersion: manifest.version || appConfig.modelVersion,
      datasetVersion: manifest.datasetVersion || appConfig.datasetVersion,
    };
    progress("neighbors", 1, "Local prediction complete");
    context.postMessage({ type: "result", value: result });
  } catch (error) {
    context.postMessage({ type: "error", error: error instanceof Error ? error.message : "Local model failed." });
  }
};

export {};
