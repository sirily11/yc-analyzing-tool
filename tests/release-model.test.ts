import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  modelObjectKey,
  packageModelArchive,
  publicModelUrl,
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
    await Promise.all(filenames.map((filename) => writeFile(path.join(source, filename), filename)));

    const result = await packageModelArchive(source, output, "release-id");
    const entries = unzipSync(new Uint8Array(await readFile(result.archivePath)));
    expect(Object.keys(entries).sort()).toEqual(
      filenames.map((filename) => `browser-fit-v1/${filename}`).sort(),
    );
    expect(path.basename(result.archivePath)).toBe("release-id-browser-fit-v1.zip");
  });
});
