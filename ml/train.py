"""Train and export the founder-aware accepted-company fit model.

This is an offline release task. It never runs inside Next.js or Vercel.
"""

from __future__ import annotations

import hashlib
import json
import math
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
PROFILE_DATA = ROOT / "ml" / "data" / "processed" / "company-profiles.jsonl"
FOUNDER_PROFILE_DATA = ROOT / "ml" / "data" / "processed" / "founder-profiles.jsonl"
FOUNDER_FEATURE_SPEC = ROOT / "lib" / "ml" / "founder-feature-spec.json"
MODEL_VERSION = "browser-fit-v2"
DATASET_VERSION = "yc-2022-2026-ytd-v2"
OUTPUT = ROOT / "ml" / "artifacts" / MODEL_VERSION
SEED = 20260720
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BROWSER_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2"
STARTUP_WEIGHT = 0.7
FOUNDER_WEIGHT = 0.3
FOUNDER_KEYS = [
    "founderCountBand",
    "capabilityDomains",
    "domainExperience",
    "technicalCapability",
    "priorBuildingExperience",
    "teamComplementarity",
]

torch.manual_seed(SEED)
np.random.seed(SEED)
torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))


class Autoencoder(nn.Module):
    def __init__(self, dimensions: int, hidden_dimensions: int, latent_dimensions: int):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(dimensions, hidden_dimensions),
            nn.ReLU(),
            nn.Linear(hidden_dimensions, latent_dimensions),
        )
        self.decoder = nn.Sequential(
            nn.Linear(latent_dimensions, hidden_dimensions),
            nn.ReLU(),
            nn.Linear(hidden_dimensions, dimensions),
        )

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        return self.decoder(self.encoder(values))


class BrowserInferenceModel(nn.Module):
    def __init__(self, startup_model: Autoencoder, founder_model: Autoencoder):
        super().__init__()
        self.startup_model = startup_model
        self.founder_model = founder_model

    def forward(
        self, startup_features: torch.Tensor, founder_features: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        startup_latent = self.startup_model.encoder(startup_features)
        founder_latent = self.founder_model.encoder(founder_features)
        return (
            self.startup_model.decoder(startup_latent),
            startup_latent,
            self.founder_model.decoder(founder_latent),
            founder_latent,
        )


def load_jsonl(path: Path) -> dict[int, dict]:
    if not path.exists():
        return {}
    return {row["id"]: row for row in map(json.loads, path.read_text().splitlines()) if row}


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


def founder_features(profile: dict, spec: dict[str, list[str]]) -> np.ndarray:
    dimensions = sum(len(spec[key]) for key in FOUNDER_KEYS)
    values = np.zeros(dimensions, dtype=np.float32)
    offset = 0
    for key in FOUNDER_KEYS:
        options = spec[key]
        selected = set(profile.get(key, [])) if key == "capabilityDomains" else {profile.get(key)}
        for index, option in enumerate(options):
            if option in selected:
                values[offset + index] = 1
        offset += len(options)
    return values


def has_founder_evidence(profile: dict) -> bool:
    return bool(profile.get("capabilityDomains")) or any(
        [
            profile.get("domainExperience") != "not-evidenced",
            profile.get("technicalCapability") != "not-evidenced",
            profile.get("priorBuildingExperience") != "not-evidenced",
            profile.get("teamComplementarity") == "demonstrated",
        ]
    )


def embedding_text(company: dict) -> str:
    return f'{company["oneLiner"]} Sector: {company["industry"]}. Customer: {company["targetMarket"]}.'


def source_hash(companies: list[dict], founder_profiles: dict[int, dict]) -> str:
    company_rows = [{key: value for key, value in company.items() if key not in {"x", "y"}} for company in companies]
    founder_rows = [founder_profiles[company["id"]] for company in companies]
    payload = {"companies": company_rows, "founders": founder_rows}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def train_model(
    values: np.ndarray,
    epochs: int,
    hidden_dimensions: int,
    latent_dimensions: int,
) -> Autoencoder:
    model = Autoencoder(values.shape[1], hidden_dimensions, latent_dimensions)
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


def grouped_oof_errors(
    raw_values: np.ndarray,
    groups: np.ndarray,
    *,
    label: str,
    hidden_dimensions: int,
    latent_dimensions: int,
) -> np.ndarray:
    errors = np.zeros(len(raw_values), dtype=np.float32)
    splitter = GroupKFold(n_splits=5)
    for fold, (train_index, validation_index) in enumerate(splitter.split(raw_values, groups=groups), start=1):
        print(f"{label} fold {fold}/5 ({len(train_index):,} train, {len(validation_index):,} validation)", flush=True)
        fold_scaler = StandardScaler().fit(raw_values[train_index])
        train_values = fold_scaler.transform(raw_values[train_index]).astype(np.float32)
        validation_values = fold_scaler.transform(raw_values[validation_index]).astype(np.float32)
        fold_model = train_model(train_values, 70, hidden_dimensions, latent_dimensions)
        with torch.no_grad():
            actual = torch.from_numpy(validation_values)
            errors[validation_index] = ((fold_model(actual) - actual) ** 2).mean(dim=1).numpy()
    return errors


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


def normalize_rows(values: np.ndarray) -> np.ndarray:
    norms = np.maximum(np.linalg.norm(values, axis=1, keepdims=True), 1e-8)
    return (values / norms).astype(np.float32)


def main() -> None:
    companies: list[dict] = json.loads(DATA.read_text())
    profiles = load_jsonl(PROFILE_DATA)
    founder_profiles = load_jsonl(FOUNDER_PROFILE_DATA)
    if len(profiles) != len(companies):
        raise RuntimeError(f"Expected {len(companies)} categorized company profiles, found {len(profiles)}. Run model:categorize first.")
    if len(founder_profiles) != len(companies):
        raise RuntimeError(f"Expected {len(companies)} founder profiles, found {len(founder_profiles)}. Run model:founders first.")

    feature_spec = json.loads(FOUNDER_FEATURE_SPEC.read_text())
    spec_hash = hashlib.sha256(FOUNDER_FEATURE_SPEC.read_bytes()).hexdigest()
    founder_available = np.asarray([has_founder_evidence(founder_profiles[item["id"]]) for item in companies], dtype=bool)
    founder_indexes = np.flatnonzero(founder_available)
    if len(founder_indexes) < 5 or len({companies[index]["batch"] for index in founder_indexes}) < 5:
        raise RuntimeError("Founder enrichment did not produce enough evidence across five YC batches.")

    print(f"Encoding {len(companies):,} public company profiles with {EMBEDDING_MODEL}.", flush=True)
    encoder = SentenceTransformer(EMBEDDING_MODEL, local_files_only=True)
    embeddings = encoder.encode(
        [embedding_text(item) for item in companies],
        batch_size=64,
        normalize_embeddings=True,
        show_progress_bar=True,
    ).astype(np.float32)
    startup_structured = np.stack([hashed_features(item, profiles[item["id"]]) for item in companies])
    startup_raw = np.concatenate([embeddings, startup_structured], axis=1).astype(np.float32)
    founder_raw = np.stack([founder_features(founder_profiles[item["id"]], feature_spec) for item in companies])
    groups = np.asarray([item["batch"] for item in companies])

    print("Generating grouped out-of-fold startup reconstruction errors.", flush=True)
    startup_oof_error = grouped_oof_errors(
        startup_raw,
        groups,
        label="Startup",
        hidden_dimensions=256,
        latent_dimensions=64,
    )
    print(f"Generating grouped out-of-fold founder reconstruction errors for {len(founder_indexes):,} evidenced profiles.", flush=True)
    founder_oof_error = grouped_oof_errors(
        founder_raw[founder_indexes],
        groups[founder_indexes],
        label="Founder",
        hidden_dimensions=32,
        latent_dimensions=8,
    )

    print("Training the final dual-branch release model.", flush=True)
    startup_scaler = StandardScaler().fit(startup_raw)
    startup_values = startup_scaler.transform(startup_raw).astype(np.float32)
    founder_scaler = StandardScaler().fit(founder_raw[founder_indexes])
    founder_values = founder_scaler.transform(founder_raw).astype(np.float32)
    founder_values[~founder_available] = 0
    startup_model = train_model(startup_values, 120, 256, 64)
    founder_model = train_model(founder_values[founder_indexes], 120, 32, 8)
    with torch.no_grad():
        startup_latent = startup_model.encoder(torch.from_numpy(startup_values)).numpy().astype(np.float32)
        founder_latent = founder_model.encoder(torch.from_numpy(founder_values)).numpy().astype(np.float32)
    startup_reference = normalize_rows(startup_latent)
    founder_reference = normalize_rows(founder_latent)
    reference_latent = np.concatenate([startup_reference, founder_reference], axis=1).astype(np.float32)

    print("Computing the learned founder-aware two-dimensional directory map.", flush=True)
    weighted_founder = founder_reference.copy()
    weighted_founder[~founder_available] = 0
    map_features = np.concatenate([
        startup_reference * math.sqrt(STARTUP_WEIGHT),
        weighted_founder * math.sqrt(FOUNDER_WEIGHT),
    ], axis=1)
    reducer = umap.UMAP(n_components=2, n_neighbors=25, min_dist=0.08, metric="cosine", random_state=SEED)
    coordinates = reducer.fit_transform(map_features).astype(np.float32)
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
    export_model = BrowserInferenceModel(startup_model, founder_model).eval()
    torch.onnx.export(
        export_model,
        (torch.from_numpy(startup_values[:1]), torch.from_numpy(founder_values[:1])),
        fp32_path,
        input_names=["startup_features", "founder_features"],
        output_names=["startup_reconstruction", "startup_latent", "founder_reconstruction", "founder_latent"],
        dynamic_axes={
            "startup_features": {0: "batch"},
            "founder_features": {0: "batch"},
            "startup_reconstruction": {0: "batch"},
            "startup_latent": {0: "batch"},
            "founder_reconstruction": {0: "batch"},
            "founder_latent": {0: "batch"},
        },
        opset_version=17,
        dynamo=False,
    )
    quantize_dynamic(fp32_path, quantized_path, weight_type=QuantType.QInt8)

    normalization = {
        "startup": {"mean": startup_scaler.mean_.tolist(), "scale": startup_scaler.scale_.tolist()},
        "founder": {"mean": founder_scaler.mean_.tolist(), "scale": founder_scaler.scale_.tolist()},
    }
    calibration = {
        "startup": np.sort(startup_oof_error).tolist(),
        "founder": np.sort(founder_oof_error).tolist(),
    }
    (OUTPUT / "normalization.json").write_text(json.dumps(normalization))
    (OUTPUT / "calibration.json").write_text(json.dumps(calibration))
    reference_latent.tofile(OUTPUT / "reference-latent.bin")
    (OUTPUT / "reference-ids.json").write_text(json.dumps([item["id"] for item in companies]))
    (OUTPUT / "reference-founder-availability.json").write_text(json.dumps(founder_available.tolist()))
    np.savez_compressed(
        OUTPUT / "reference-latent.npz",
        ids=np.asarray([item["id"] for item in companies]),
        startup=startup_reference,
        founder=founder_reference,
        founder_available=founder_available,
    )
    (OUTPUT / "directory-companies.json").write_text(json.dumps(directory_companies))

    startup_scores = fit_scores(startup_oof_error)
    founder_scores = fit_scores(founder_oof_error)
    combined_scores = startup_scores[founder_indexes] * STARTUP_WEIGHT + founder_scores * FOUNDER_WEIGHT
    founder_companies = [companies[index] for index in founder_indexes]
    evaluation = {
        "scoreKind": "fit",
        "trainingCompanies": len(companies),
        "categorizedProfiles": len(profiles),
        "founderProfiles": len(founder_profiles),
        "founderEvidenceCompanies": int(founder_available.sum()),
        "founderEvidenceCoverage": float(founder_available.mean()),
        "weights": {"startup": STARTUP_WEIGHT, "founder": FOUNDER_WEIGHT},
        "oofReconstructionError": {
            "startup": {
                "mean": float(startup_oof_error.mean()),
                "p50": float(np.percentile(startup_oof_error, 50)),
                "p90": float(np.percentile(startup_oof_error, 90)),
            },
            "founder": {
                "mean": float(founder_oof_error.mean()),
                "p50": float(np.percentile(founder_oof_error, 50)),
                "p90": float(np.percentile(founder_oof_error, 90)),
            },
        },
        "startupScoreByBatch": group_summary(companies, startup_scores, "batch"),
        "startupScoreBySector": group_summary(companies, startup_scores, "industry"),
        "founderScoreByBatch": group_summary(founder_companies, founder_scores, "batch"),
        "founderScoreBySector": group_summary(founder_companies, founder_scores, "industry"),
        "combinedScoreByBatch": group_summary(founder_companies, combined_scores, "batch"),
        "combinedScoreBySector": group_summary(founder_companies, combined_scores, "industry"),
    }
    (OUTPUT / "evaluation.json").write_text(json.dumps(evaluation, indent=2))

    manifest = {
        "version": MODEL_VERSION,
        "datasetVersion": DATASET_VERSION,
        "datasetSourceHash": source_hash(companies, founder_profiles),
        "runtime": "onnx",
        "embeddingModel": BROWSER_EMBEDDING_MODEL,
        "trainingEmbeddingModel": EMBEDDING_MODEL,
        "embeddingDimensions": int(embeddings.shape[1]),
        "startupStructuredDimensions": int(startup_structured.shape[1]),
        "startupFeatureDimensions": int(startup_values.shape[1]),
        "founderFeatureDimensions": int(founder_values.shape[1]),
        "startupBottleneckDimensions": int(startup_latent.shape[1]),
        "founderBottleneckDimensions": int(founder_latent.shape[1]),
        "referenceDimensions": int(reference_latent.shape[1]),
        "trainingCompanies": len(companies),
        "categorizedProfiles": len(profiles),
        "founderProfiles": len(founder_profiles),
        "founderEvidenceCompanies": int(founder_available.sum()),
        "scoreWeights": {"startup": STARTUP_WEIGHT, "founder": FOUNDER_WEIGHT},
        "founderFeatureSpecHash": spec_hash,
        "seed": SEED,
        "quantization": "dynamic-int8-weights",
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Artifacts written to {OUTPUT}. Validating and releasing the model.", flush=True)
    subprocess.run([sys.executable, str(ROOT / "ml" / "validate_artifacts.py"), "--promote"], cwd=ROOT, check=True)
    subprocess.run(["bun", "run", "model:upload", "--", "--model-version", MODEL_VERSION], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
