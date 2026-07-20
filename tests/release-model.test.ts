import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  applyModelDirectoryCoordinates,
  modelObjectKey,
  packageModelArchive,
  parseModelDirectoryCoordinates,
  publicModelUrl,
  withActiveModelConfig,
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
    await Promise.all(filenames.map((filename) => writeFile(path.join(source, filename), filename === "manifest.json" ? JSON.stringify({ version: "browser-fit-v1", datasetVersion: "dataset-v1", trainingCompanies: 1 }) : filename)));

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
    await Promise.all(filenames.map((filename) => writeFile(path.join(source, filename), filename === "manifest.json" ? JSON.stringify({ version: "browser-fit-v2", datasetVersion: "dataset-v2", trainingCompanies: 1, founderFeatureDimensions: 25 }) : filename)));

    const result = await packageModelArchive(source, output, "release-id");
    const entries = unzipSync(new Uint8Array(await readFile(result.archivePath)));
    expect(Object.keys(entries)).toContain("browser-fit-v2/reference-founder-availability.json");
    expect(path.basename(result.archivePath)).toBe("release-id-browser-fit-v2.zip");
  });

  it("validates promoted coordinates against the exact model reference IDs", () => {
    const directory = JSON.stringify([
      { id: 2, x: 0.8, y: 0.2 },
      { id: 1, x: 0.1, y: 0.9 },
    ]);
    expect(parseModelDirectoryCoordinates(directory, "[1,2]", 2)).toEqual([
      { id: 2, x: 0.8, y: 0.2 },
      { id: 1, x: 0.1, y: 0.9 },
    ]);
    expect(() => parseModelDirectoryCoordinates(directory, "[1,3]", 2)).toThrow("do not exactly match");
    expect(() => parseModelDirectoryCoordinates('[{"id":1,"x":1.1,"y":0}]', "[1]", 1)).toThrow("outside the normalized map bounds");
    expect(() => parseModelDirectoryCoordinates('[{"id":1,"x":0,"y":0},{"id":1,"x":1,"y":1}]', "[1,2]", 2)).toThrow("duplicate company ID");
  });

  it("updates only model-backed Turso coordinates inside the caller's transaction", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.execute("CREATE TABLE yc_companies (id INTEGER PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL, updated_at INTEGER NOT NULL)");
      await client.batch([
        { sql: "INSERT INTO yc_companies VALUES (?, ?, ?, ?)", args: [1, 0, 0, 1] },
        { sql: "INSERT INTO yc_companies VALUES (?, ?, ?, ?)", args: [2, 0, 0, 1] },
        { sql: "INSERT INTO yc_companies VALUES (?, ?, ?, ?)", args: [3, 0.3, 0.3, 1] },
      ], "write");
      const transaction = await client.transaction("write");
      try {
        await expect(applyModelDirectoryCoordinates(transaction, [
          { id: 1, x: 0.1, y: 0.9 },
          { id: 2, x: 0.8, y: 0.2 },
        ], 2_000)).resolves.toBe(2);
        const result = await transaction.execute("SELECT id, x, y, updated_at FROM yc_companies ORDER BY id");
        expect(result.rows).toEqual([
          { id: 1, x: 0.1, y: 0.9, updated_at: 2_000 },
          { id: 2, x: 0.8, y: 0.2, updated_at: 2_000 },
          { id: 3, x: 0.3, y: 0.3, updated_at: 1 },
        ]);
        await transaction.commit();
      } finally {
        transaction.close();
      }
    } finally {
      client.close();
    }
  });
});
