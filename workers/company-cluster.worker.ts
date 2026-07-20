/// <reference lib="webworker" />

import { pipeline } from "@huggingface/transformers";
import { UMAP } from "umap-js";
import { appConfig } from "@/config";
import { blendCompanySignals, companyLatentShape, COMPANY_CLUSTER_MODEL_WEIGHT, COMPANY_CLUSTER_SEED, COMPANY_CLUSTER_WEB_WEIGHT, fallbackCompanyClusterMap, normalizeClusterCoordinates, seededRandom, selectNearestPeerIds } from "@/lib/ml/company-cluster-core";
import { downloadModelArchive } from "@/lib/ml/model-archive";
import type { CompanyResearchMapInput } from "@/lib/types/company-research";
import type { YcCompany } from "@/lib/types/company";

const context: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function progress(progress: number, label: string) {
  context.postMessage({ type: "progress", value: { progress, label } });
}

context.onmessage = async (event: MessageEvent<{ mapInput: CompanyResearchMapInput }>) => {
  let companies: YcCompany[] = [];
  let embeddingModel = "unknown";
  const targetIds = new Set(event.data.mapInput.targets.map((target) => target.companyId));
  const textSources = new Map(event.data.mapInput.targets.map((target) => [target.companyId, target.textSource]));
  try {
    progress(0.08, "Loading the versioned company model");
    const [directory, archive] = await Promise.all([
      fetch("/data/yc-companies.json").then((response) => response.json()) as Promise<YcCompany[]>,
      downloadModelArchive(appConfig.modelArchiveUrl),
    ]);
    embeddingModel = archive.manifest.embeddingModel;
    const companyById = new Map(directory.map((company) => [company.id, company]));
    const referenceValues = new Float32Array(archive.referenceLatent.buffer, archive.referenceLatent.byteOffset, archive.referenceLatent.byteLength / Float32Array.BYTES_PER_ELEMENT);
    const { rowDimensions, startupDimensions } = companyLatentShape(archive.manifest);
    if (referenceValues.length !== archive.referenceIds.length * rowDimensions) throw new Error("MODEL_REFERENCE_DIMENSION_MISMATCH");
    const latentById = new Map(archive.referenceIds.map((id, row) => [id, referenceValues.slice(row * rowDimensions, row * rowDimensions + startupDimensions)]));
    const peers = selectNearestPeerIds({ referenceIds: archive.referenceIds, latentById, targetIds, limit: 40 });
    const nodeIds = [...event.data.mapInput.targets.map((target) => target.companyId), ...peers].slice(0, 50);
    companies = nodeIds.flatMap((id) => companyById.get(id) ?? []);
    if (companies.length < 3) throw new Error("COMPANY_CLUSTER_TOO_SMALL");

    progress(0.28, "Embedding current website and YC descriptions");
    const extractor = await pipeline("feature-extraction", embeddingModel, { dtype: "q8" });
    const targetText = new Map(event.data.mapInput.targets.map((target) => [target.companyId, target.semanticText]));
    const features: number[][] = [];
    for (let index = 0; index < companies.length; index += 1) {
      const company = companies[index];
      const text = targetText.get(company.id) ?? `${company.name}. ${company.oneLiner}. ${company.industry}. ${company.subindustry}. Customer: ${company.targetMarket}.`;
      const encoded = await extractor(text, { pooling: "mean", normalize: true });
      const latent = latentById.get(company.id);
      if (!latent) throw new Error("COMPANY_LATENT_MISSING");
      features.push(blendCompanySignals(latent, encoded.data as Float32Array));
      progress(0.3 + (index + 1) / companies.length * 0.42, `Embedding ${index + 1} of ${companies.length} companies`);
    }

    progress(0.78, "Fitting the request-specific semantic map");
    const reducer = new UMAP({ nComponents: 2, nNeighbors: Math.min(15, companies.length - 1), minDist: 0.1, random: seededRandom(COMPANY_CLUSTER_SEED) });
    const points = normalizeClusterCoordinates(reducer.fit(features));
    context.postMessage({
      type: "result",
      value: {
        mode: "semantic",
        algorithm: "umap",
        seed: COMPANY_CLUSTER_SEED,
        modelWeight: COMPANY_CLUSTER_MODEL_WEIGHT,
        webWeight: COMPANY_CLUSTER_WEB_WEIGHT,
        embeddingModel,
        modelVersion: archive.manifest.version || appConfig.modelVersion,
        datasetVersion: archive.manifest.datasetVersion || appConfig.datasetVersion,
        warning: null,
        points: companies.map((company, index) => ({ companyId: company.id, ...points[index], target: targetIds.has(company.id), textSource: textSources.get(company.id) ?? "dataset" })),
      },
    });
  } catch (cause) {
    if (!companies.length) {
      try {
        const directory = await fetch("/data/yc-companies.json").then((response) => response.json()) as YcCompany[];
        const targets = directory.filter((company) => targetIds.has(company.id));
        const contextCompanies = directory.filter((company) => !targetIds.has(company.id)).slice(0, Math.max(0, 50 - targets.length));
        companies = [...targets, ...contextCompanies];
      } catch {
        // The final error below is more useful than a second fetch failure.
      }
    }
    if (companies.length) {
      context.postMessage({ type: "result", value: fallbackCompanyClusterMap({ companies, targetIds, textSources, embeddingModel, modelVersion: appConfig.modelVersion, datasetVersion: appConfig.datasetVersion, warning: `Dynamic semantic layout was unavailable: ${cause instanceof Error ? cause.message : "unknown error"}` }) });
    } else {
      context.postMessage({ type: "error", error: cause instanceof Error ? cause.message : "Company cluster map failed." });
    }
  }
};

export {};
