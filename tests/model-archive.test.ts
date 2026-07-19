import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseModelArchive } from "@/lib/ml/model-archive";

const json = (value: unknown) => strToU8(JSON.stringify(value));

function archive(overrides: Record<string, Uint8Array> = {}) {
  return zipSync({
    "browser-fit-v1/manifest.json": json({
      version: "browser-fit-v1",
      datasetVersion: "dataset-v1",
      runtime: "onnx",
      embeddingModel: "encoder",
      featureDimensions: 4,
      bottleneckDimensions: 1,
    }),
    "browser-fit-v1/model.onnx": new Uint8Array([1, 2, 3]),
    "browser-fit-v1/normalization.json": json({ mean: [0, 0, 0, 0], scale: [1, 1, 1, 1] }),
    "browser-fit-v1/calibration.json": json([0.1, 0.2]),
    "browser-fit-v1/reference-latent.bin": new Uint8Array(new Float32Array([0.25, 0.5]).buffer),
    "browser-fit-v1/reference-ids.json": json([10, 20]),
    ...overrides,
  });
}

describe("model archive", () => {
  it("loads runtime artifacts from a versioned folder", () => {
    const model = parseModelArchive(archive());
    expect(model.manifest.version).toBe("browser-fit-v1");
    expect(Array.from(model.model)).toEqual([1, 2, 3]);
    expect(model.referenceIds).toEqual([10, 20]);
    expect(Array.from(new Float32Array(model.referenceLatent.buffer))).toEqual([0.25, 0.5]);
  });

  it("loads the founder-aware calibration and availability contract", () => {
    const bytes = zipSync({
      "browser-fit-v2/manifest.json": json({
        version: "browser-fit-v2",
        datasetVersion: "dataset-v2",
        runtime: "onnx",
        embeddingModel: "encoder",
        startupFeatureDimensions: 4,
        founderFeatureDimensions: 2,
        startupBottleneckDimensions: 1,
        founderBottleneckDimensions: 1,
        referenceDimensions: 2,
        scoreWeights: { startup: 0.7, founder: 0.3 },
      }),
      "browser-fit-v2/model.onnx": new Uint8Array([1]),
      "browser-fit-v2/normalization.json": json({ startup: { mean: [0, 0, 0, 0], scale: [1, 1, 1, 1] }, founder: { mean: [0, 0], scale: [1, 1] } }),
      "browser-fit-v2/calibration.json": json({ startup: [0.1, 0.2], founder: [0.1] }),
      "browser-fit-v2/reference-latent.bin": new Uint8Array(new Float32Array([0.25, 0.5, 0.75, 1]).buffer),
      "browser-fit-v2/reference-ids.json": json([10, 20]),
      "browser-fit-v2/reference-founder-availability.json": json([true, false]),
    });

    const model = parseModelArchive(bytes);
    expect(model.referenceFounderAvailability).toEqual([true, false]);
    expect(model.calibration).toEqual({ startup: [0.1, 0.2], founder: [0.1] });
  });

  it("rejects an archive missing a required artifact", () => {
    const entries = zipSync({ "manifest.json": json({ runtime: "onnx" }) });
    expect(() => parseModelArchive(entries)).toThrow("MODEL_ARCHIVE_INVALID:model.onnx");
  });
});
