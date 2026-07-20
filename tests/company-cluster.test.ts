import { UMAP } from "umap-js";
import { describe, expect, it } from "vitest";
import { blendCompanySignals, companyLatentShape, fallbackCompanyClusterMap, normalizeClusterCoordinates, seededRandom, selectNearestPeerIds } from "@/lib/ml/company-cluster-core";

describe("company cluster math", () => {
  it("preserves the planned 70/30 squared signal weighting", () => {
    const blended = blendCompanySignals([3, 4], [0, 2]);
    expect(blended.slice(0, 2).reduce((sum, value) => sum + value ** 2, 0)).toBeCloseTo(0.7, 8);
    expect(blended.slice(2).reduce((sum, value) => sum + value ** 2, 0)).toBeCloseTo(0.3, 8);
  });

  it("produces deterministic random values and bounded map coordinates", () => {
    const left = seededRandom(42); const right = seededRandom(42);
    expect([left(), left(), left()]).toEqual([right(), right(), right()]);
    expect(normalizeClusterCoordinates([[10, -5], [20, 5]])).toEqual([{ x: 0.04, y: 0.04 }, { x: 0.96, y: 0.96 }]);
  });

  it("reads startup latent dimensions from legacy and founder-aware archives", () => {
    expect(companyLatentShape({ version: "v1", datasetVersion: "d1", runtime: "onnx", embeddingModel: "e", featureDimensions: 4, bottleneckDimensions: 3 })).toEqual({ rowDimensions: 3, startupDimensions: 3 });
    expect(companyLatentShape({ version: "v2", datasetVersion: "d2", runtime: "onnx", embeddingModel: "e", startupFeatureDimensions: 4, founderFeatureDimensions: 2, startupBottleneckDimensions: 3, founderBottleneckDimensions: 2, referenceDimensions: 5, scoreWeights: { startup: 0.7, founder: 0.3 } })).toEqual({ rowDimensions: 5, startupDimensions: 3 });
  });

  it("selects nearest peers deterministically and preserves dataset fallback labels", () => {
    const latentById = new Map([
      [1, new Float32Array([0, 0])],
      [2, new Float32Array([1, 0])],
      [3, new Float32Array([0.2, 0])],
      [4, new Float32Array([0.2, 0])],
    ]);
    expect(selectNearestPeerIds({ referenceIds: [1, 2, 4, 3], latentById, targetIds: new Set([1]), limit: 2 })).toEqual([3, 4]);
    const company = { id: 1, x: 0.25, y: 0.75 } as never;
    const fallback = fallbackCompanyClusterMap({ companies: [company], targetIds: new Set([1]), textSources: new Map(), embeddingModel: "e", modelVersion: "m", datasetVersion: "d", warning: "fallback" });
    expect(fallback).toMatchObject({ mode: "fallback-global", warning: "fallback", points: [{ companyId: 1, x: 0.25, y: 0.75, target: true, textSource: "dataset" }] });
  });

  it("runs seeded UMAP deterministically", () => {
    const features = [[0, 0], [0.1, 0], [1, 1], [1, 0.9]];
    const options = { nComponents: 2, nNeighbors: 2, nEpochs: 30, random: seededRandom(42) };
    const left = normalizeClusterCoordinates(new UMAP(options).fit(features));
    const right = normalizeClusterCoordinates(new UMAP({ ...options, random: seededRandom(42) }).fit(features));
    expect(left).toEqual(right);
  });
});
