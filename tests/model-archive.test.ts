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

  it("rejects an archive missing a required artifact", () => {
    const entries = zipSync({ "manifest.json": json({ runtime: "onnx" }) });
    expect(() => parseModelArchive(entries)).toThrow("MODEL_ARCHIVE_INVALID:model.onnx");
  });
});
