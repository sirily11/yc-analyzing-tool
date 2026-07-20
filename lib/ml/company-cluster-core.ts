import type { CompanyClusterMap } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";
import { isFounderAwareManifest, type ModelManifest } from "@/lib/ml/model-archive";

export const COMPANY_CLUSTER_SEED = 42;
export const COMPANY_CLUSTER_MODEL_WEIGHT = 0.7;
export const COMPANY_CLUSTER_WEB_WEIGHT = 0.3;

export function normalizeVector(values: ArrayLike<number>) {
  let squared = 0;
  for (let index = 0; index < values.length; index += 1) squared += values[index] ** 2;
  const norm = Math.max(1e-8, Math.sqrt(squared));
  return Array.from(values, (value) => value / norm);
}

export function blendCompanySignals(model: ArrayLike<number>, web: ArrayLike<number>, modelWeight = COMPANY_CLUSTER_MODEL_WEIGHT, webWeight = COMPANY_CLUSTER_WEB_WEIGHT) {
  const modelScale = Math.sqrt(modelWeight);
  const webScale = Math.sqrt(webWeight);
  return [...normalizeVector(model).map((value) => value * modelScale), ...normalizeVector(web).map((value) => value * webScale)];
}

export function squaredDistance(left: ArrayLike<number>, right: ArrayLike<number>) {
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) distance += (left[index] - right[index]) ** 2;
  return distance;
}

export function companyLatentShape(manifest: ModelManifest) {
  return isFounderAwareManifest(manifest)
    ? { rowDimensions: manifest.referenceDimensions, startupDimensions: manifest.startupBottleneckDimensions }
    : { rowDimensions: manifest.bottleneckDimensions, startupDimensions: manifest.bottleneckDimensions };
}

export function selectNearestPeerIds(input: { referenceIds: number[]; latentById: Map<number, Float32Array>; targetIds: Set<number>; limit?: number }) {
  const targets = [...input.targetIds].map((id) => input.latentById.get(id));
  if (!targets.length || targets.some((latent) => !latent)) throw new Error("COMPANY_TARGET_LATENT_MISSING");
  return input.referenceIds.filter((id) => !input.targetIds.has(id)).map((id) => {
    const latent = input.latentById.get(id);
    if (!latent) throw new Error("COMPANY_LATENT_MISSING");
    return { id, distance: Math.min(...targets.map((target) => squaredDistance(latent, target!))) };
  }).sort((left, right) => left.distance - right.distance || left.id - right.id).slice(0, input.limit ?? 40).map(({ id }) => id);
}

export function normalizeClusterCoordinates(coordinates: number[][]) {
  const minX = Math.min(...coordinates.map((point) => point[0]));
  const maxX = Math.max(...coordinates.map((point) => point[0]));
  const minY = Math.min(...coordinates.map((point) => point[1]));
  const maxY = Math.max(...coordinates.map((point) => point[1]));
  const rangeX = Math.max(1e-8, maxX - minX);
  const rangeY = Math.max(1e-8, maxY - minY);
  return coordinates.map(([x, y]) => ({
    x: Number((0.04 + (x - minX) / rangeX * 0.92).toFixed(5)),
    y: Number((0.04 + (y - minY) / rangeY * 0.92).toFixed(5)),
  }));
}

export function seededRandom(seed = COMPANY_CLUSTER_SEED) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4_294_967_296;
  };
}

export function fallbackCompanyClusterMap(input: { companies: YcCompany[]; targetIds: Set<number>; textSources: Map<number, "firecrawl" | "dataset">; embeddingModel: string; modelVersion: string; datasetVersion: string; warning: string }): CompanyClusterMap {
  return {
    mode: "fallback-global",
    algorithm: "umap",
    seed: COMPANY_CLUSTER_SEED,
    modelWeight: COMPANY_CLUSTER_MODEL_WEIGHT,
    webWeight: COMPANY_CLUSTER_WEB_WEIGHT,
    embeddingModel: input.embeddingModel,
    modelVersion: input.modelVersion,
    datasetVersion: input.datasetVersion,
    warning: input.warning,
    points: input.companies.slice(0, 50).map((company) => ({ companyId: company.id, x: company.x, y: company.y, target: input.targetIds.has(company.id), textSource: input.textSources.get(company.id) ?? "dataset" })),
  };
}
