import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  modelObjectKey,
  packageModelArchive,
  publicModelUrl,
  withActiveModelConfig,
  withDatasetManifestVersion,
  withModelArchiveUrl,
} from "@/scripts/release-model";

describe("model release", () => {
  it("builds a random-prefixed object key and custom-domain URL", () => {
    const key = modelObjectKey("models/releases", "release-id", "browser-fit-v1");
    expect(key).toBe("models/releases/release-id-browser-fit-v1.zip");
    expect(publicModelUrl("https://models.example.com/", key)).toBe(
      "https://models.example.com/models/releases/release-id-browser-fit-v1.zip",
    );
  });

  it("switches model, dataset, and archive URL together", () => {
    const source = 'const config = { datasetVersion: "v1", modelVersion: "m1", modelArchiveUrl: "old" };';
    expect(withActiveModelConfig(source, { modelVersion: "m2", datasetVersion: "v2", archiveUrl: "https://models.example.com/m2.zip" })).toBe(
      'const config = { datasetVersion: "v2", modelVersion: "m2", modelArchiveUrl: "https://models.example.com/m2.zip" };',
    );
    expect(JSON.parse(withDatasetManifestVersion('{"version":"v1","source":"test"}', "v2"))).toEqual({ version: "v2", source: "test" });
  });

  it("replaces only the configured model archive URL", () => {
    const source = 'const config = { modelArchiveUrl: "old", another: "old" };';
    expect(withModelArchiveUrl(source, "https://models.example.com/new.zip")).toBe(
      'const config = { modelArchiveUrl: "https://models.example.com/new.zip", another: "old" };',
    );
  });

  it("packages every promoted runtime artifact under the model version", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "model-release-"));
    const source = path.join(temporary, "source");
    const output = path.join(temporary, "output");
    await mkdir(source);
    const filenames = [
      "model.onnx",
      "normalization.json",
      "calibration.json",
      "reference-latent.bin",
      "reference-ids.json",
      "evaluation.json",
      "manifest.json",
    ];
    await Promise.all(filenames.map((filename) => writeFile(path.join(source, filename), filename === "manifest.json" ? JSON.stringify({ version: "browser-fit-v1", datasetVersion: "dataset-v1" }) : filename)));

    const result = await packageModelArchive(source, output, "release-id");
    const entries = unzipSync(new Uint8Array(await readFile(result.archivePath)));
    expect(Object.keys(entries).sort()).toEqual(
      filenames.map((filename) => `browser-fit-v1/${filename}`).sort(),
    );
    expect(path.basename(result.archivePath)).toBe("release-id-browser-fit-v1.zip");
  });

  it("includes founder availability for a v2 manifest", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "model-release-v2-"));
    const source = path.join(temporary, "source");
    const output = path.join(temporary, "output");
    await mkdir(source);
    const filenames = [
      "model.onnx", "normalization.json", "calibration.json", "reference-latent.bin",
      "reference-ids.json", "reference-founder-availability.json", "evaluation.json", "manifest.json",
    ];
    await Promise.all(filenames.map((filename) => writeFile(path.join(source, filename), filename === "manifest.json" ? JSON.stringify({ version: "browser-fit-v2", datasetVersion: "dataset-v2", founderFeatureDimensions: 25 }) : filename)));

    const result = await packageModelArchive(source, output, "release-id");
    const entries = unzipSync(new Uint8Array(await readFile(result.archivePath)));
    expect(Object.keys(entries)).toContain("browser-fit-v2/reference-founder-availability.json");
    expect(path.basename(result.archivePath)).toBe("release-id-browser-fit-v2.zip");
  });
});
