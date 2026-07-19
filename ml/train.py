"""Train and export the accepted-company fit autoencoder.

This is an offline release task. It never runs inside Next.js or Vercel.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import torch
import umap
from onnxruntime.quantization import QuantType, quantize_dynamic
from sentence_transformers import SentenceTransformer
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler
from torch import nn

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data" / "yc-companies.json"
DATA_MANIFEST = ROOT / "public" / "data" / "manifest.json"
PROFILE_DATA = ROOT / "ml" / "data" / "processed" / "company-profiles.jsonl"
OUTPUT = ROOT / "ml" / "artifacts" / "browser-fit-v1"
SEED = 20260719
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BROWSER_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2"

torch.manual_seed(SEED)
np.random.seed(SEED)
torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))


class Autoencoder(nn.Module):
    def __init__(self, dimensions: int):
        super().__init__()
        self.encoder = nn.Sequential(nn.Linear(dimensions, 256), nn.ReLU(), nn.Linear(256, 64))
        self.decoder = nn.Sequential(nn.Linear(64, 256), nn.ReLU(), nn.Linear(256, dimensions))

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        return self.decoder(self.encoder(values))


class BrowserInferenceModel(nn.Module):
    def __init__(self, model: Autoencoder):
        super().__init__()
        self.model = model

    def forward(self, values: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        latent = self.model.encoder(values)
        return self.model.decoder(latent), latent


def hashed_features(company: dict, profile: dict | None) -> np.ndarray:
    values = np.zeros(32, dtype=np.float32)
    profile = profile or {}
    labels = [
        str(profile.get("sector") or company.get("industry", "")),
        str(profile.get("targetCustomer") or company.get("targetMarket", "")),
        str(profile.get("geography") or company.get("operatingArea", "")),
        str(profile.get("aiLinked") if "aiLinked" in profile else company.get("aiLinked", False)),
        str(profile.get("businessModel", "Missing")),
        str(profile.get("productModality", "Missing")),
        str(profile.get("stage", "Missing")),
        str(profile.get("teamSizeBand", "Missing")),
    ]
    for label in labels:
        value = 2166136261
        for character in label:
            value ^= ord(character)
            value = (value * 16777619) & 0xFFFFFFFF
        values[value % len(values)] += 1
    return values


def embedding_text(company: dict) -> str:
    return f'{company["oneLiner"]} Sector: {company["industry"]}. Customer: {company["targetMarket"]}.'


def source_hash(companies: list[dict]) -> str:
    source_rows = [{key: value for key, value in company.items() if key not in {"x", "y"}} for company in companies]
    return hashlib.sha256(json.dumps(source_rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def train_model(values: np.ndarray, epochs: int) -> Autoencoder:
    model = Autoencoder(values.shape[1])
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    tensor = torch.from_numpy(values)
    for epoch in range(epochs):
        noisy = tensor + torch.randn_like(tensor) * 0.025
        loss = nn.functional.mse_loss(model(noisy), tensor)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        if epoch == 0 or (epoch + 1) % 20 == 0 or epoch + 1 == epochs:
            print(f"  epoch {epoch + 1:>3}/{epochs}: loss={loss.item():.6f}", flush=True)
    return model.eval()


def fit_scores(errors: np.ndarray) -> np.ndarray:
    ordered = np.sort(errors)
    lower_count = np.searchsorted(ordered, errors, side="left")
    return (1 - lower_count / len(ordered)) * 100


def group_summary(companies: list[dict], scores: np.ndarray, key: str) -> dict[str, dict[str, float | int]]:
    result: dict[str, dict[str, float | int]] = {}
    values = sorted({str(company[key]) for company in companies})
    for value in values:
        group_scores = scores[[str(company[key]) == value for company in companies]]
        result[value] = {
            "count": int(len(group_scores)),
            "mean": round(float(group_scores.mean()), 3),
            "p10": round(float(np.percentile(group_scores, 10)), 3),
            "p50": round(float(np.percentile(group_scores, 50)), 3),
            "p90": round(float(np.percentile(group_scores, 90)), 3),
        }
    return result


def main() -> None:
    companies: list[dict] = json.loads(DATA.read_text())
    data_manifest = json.loads(DATA_MANIFEST.read_text())
    profiles: dict[int, dict] = {}
    if PROFILE_DATA.exists():
        profiles = {row["id"]: row for row in map(json.loads, PROFILE_DATA.read_text().splitlines()) if row}
    if profiles and len(profiles) != len(companies):
        raise RuntimeError(f"Expected {len(companies)} categorized profiles, found {len(profiles)}. Resume categorization before training.")

    print(f"Encoding {len(companies):,} public company profiles with {EMBEDDING_MODEL}.", flush=True)
    encoder = SentenceTransformer(EMBEDDING_MODEL, local_files_only=True)
    embeddings = encoder.encode(
        [embedding_text(item) for item in companies],
        batch_size=64,
        normalize_embeddings=True,
        show_progress_bar=True,
    ).astype(np.float32)
    structured = np.stack([hashed_features(item, profiles.get(item["id"])) for item in companies])
    raw_features = np.concatenate([embeddings, structured], axis=1).astype(np.float32)
    groups = np.array([item["batch"] for item in companies])

    print("Generating grouped out-of-fold reconstruction errors.", flush=True)
    oof_error = np.zeros(len(raw_features), dtype=np.float32)
    splitter = GroupKFold(n_splits=5)
    for fold, (train_index, validation_index) in enumerate(splitter.split(raw_features, groups=groups), start=1):
        print(f"Fold {fold}/5 ({len(train_index):,} train, {len(validation_index):,} validation)", flush=True)
        fold_scaler = StandardScaler().fit(raw_features[train_index])
        train_values = fold_scaler.transform(raw_features[train_index]).astype(np.float32)
        validation_values = fold_scaler.transform(raw_features[validation_index]).astype(np.float32)
        fold_model = train_model(train_values, epochs=70)
        with torch.no_grad():
            actual = torch.from_numpy(validation_values)
            oof_error[validation_index] = ((fold_model(actual) - actual) ** 2).mean(dim=1).numpy()

    print("Training the final release model.", flush=True)
    scaler = StandardScaler().fit(raw_features)
    features = scaler.transform(raw_features).astype(np.float32)
    model = train_model(features, epochs=120)
    with torch.no_grad():
        latent = model.encoder(torch.from_numpy(features)).numpy().astype(np.float32)

    print("Computing the learned two-dimensional directory map.", flush=True)
    reducer = umap.UMAP(n_components=2, n_neighbors=25, min_dist=0.08, metric="cosine", random_state=SEED)
    coordinates = reducer.fit_transform(latent).astype(np.float32)
    coordinate_min = coordinates.min(axis=0)
    coordinate_range = np.maximum(np.ptp(coordinates, axis=0), 1e-8)
    coordinates = 0.04 + (coordinates - coordinate_min) / coordinate_range * 0.92
    directory_companies = [
        {**company, "x": round(float(coordinates[index, 0]), 5), "y": round(float(coordinates[index, 1]), 5)}
        for index, company in enumerate(companies)
    ]

    OUTPUT.mkdir(parents=True, exist_ok=True)
    fp32_path = OUTPUT / "model.fp32.onnx"
    quantized_path = OUTPUT / "model.onnx"
    export_model = BrowserInferenceModel(model).eval()
    torch.onnx.export(
        export_model,
        torch.from_numpy(features[:1]),
        fp32_path,
        input_names=["features"],
        output_names=["reconstruction", "latent"],
        dynamic_axes={"features": {0: "batch"}, "reconstruction": {0: "batch"}, "latent": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    quantize_dynamic(fp32_path, quantized_path, weight_type=QuantType.QInt8)

    (OUTPUT / "normalization.json").write_text(json.dumps({"mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist()}))
    (OUTPUT / "calibration.json").write_text(json.dumps(np.sort(oof_error).tolist()))
    latent.tofile(OUTPUT / "reference-latent.bin")
    (OUTPUT / "reference-ids.json").write_text(json.dumps([item["id"] for item in companies]))
    np.savez_compressed(OUTPUT / "reference-latent.npz", ids=np.array([item["id"] for item in companies]), latent=latent)
    (OUTPUT / "directory-companies.json").write_text(json.dumps(directory_companies))

    scores = fit_scores(oof_error)
    evaluation = {
        "scoreKind": "fit",
        "trainingCompanies": len(companies),
        "categorizedProfiles": len(profiles),
        "oofReconstructionError": {
            "mean": float(oof_error.mean()),
            "p50": float(np.percentile(oof_error, 50)),
            "p90": float(np.percentile(oof_error, 90)),
        },
        "scoreByBatch": group_summary(companies, scores, "batch"),
        "scoreBySector": group_summary(companies, scores, "industry"),
    }
    (OUTPUT / "evaluation.json").write_text(json.dumps(evaluation, indent=2))

    manifest = {
        "version": "browser-fit-v1",
        "datasetVersion": data_manifest["version"],
        "datasetSourceHash": source_hash(companies),
        "runtime": "onnx",
        "embeddingModel": BROWSER_EMBEDDING_MODEL,
        "trainingEmbeddingModel": EMBEDDING_MODEL,
        "embeddingDimensions": int(embeddings.shape[1]),
        "structuredDimensions": int(structured.shape[1]),
        "featureDimensions": int(features.shape[1]),
        "bottleneckDimensions": int(latent.shape[1]),
        "trainingCompanies": len(companies),
        "categorizedProfiles": len(profiles),
        "seed": SEED,
        "quantization": "dynamic-int8-weights",
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Artifacts written to {OUTPUT}. Validating and releasing the model.", flush=True)
    subprocess.run([sys.executable, str(ROOT / "ml" / "validate_artifacts.py"), "--promote"], cwd=ROOT, check=True)
    subprocess.run(["bun", "run", "model:upload"], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
