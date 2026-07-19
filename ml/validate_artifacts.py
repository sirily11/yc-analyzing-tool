from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[1]
MODEL_VERSION = "browser-fit-v2"
ARTIFACTS = ROOT / "ml" / "artifacts" / MODEL_VERSION
PUBLIC_MODEL = ROOT / "public" / "models" / MODEL_VERSION
PUBLIC_DATA = ROOT / "public" / "data" / "yc-companies.json"
FOUNDER_PROFILES = ROOT / "ml" / "data" / "processed" / "founder-profiles.jsonl"
FOUNDER_FEATURE_SPEC = ROOT / "lib" / "ml" / "founder-feature-spec.json"


def load_jsonl(path: Path) -> dict[int, dict]:
    return {row["id"]: row for row in map(json.loads, path.read_text().splitlines()) if row}


def source_hash(companies_path: Path, founder_profiles_path: Path) -> str:
    companies = json.loads(companies_path.read_text())
    founder_profiles = load_jsonl(founder_profiles_path)
    company_rows = [{key: value for key, value in company.items() if key not in {"x", "y"}} for company in companies]
    founder_rows = [founder_profiles[company["id"]] for company in companies]
    payload = {"companies": company_rows, "founders": founder_rows}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def infer(path: Path, startup: np.ndarray, founder: np.ndarray) -> list[np.ndarray]:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return session.run(None, {"startup_features": startup, "founder_features": founder})


def finite_sorted(values: np.ndarray) -> bool:
    return bool(np.isfinite(values).all() and values.min() >= 0 and np.all(values[:-1] <= values[1:]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--promote", action="store_true", help="Copy validated runtime artifacts into public/models without activating them.")
    args = parser.parse_args()

    manifest = json.loads((ARTIFACTS / "manifest.json").read_text())
    normalization = json.loads((ARTIFACTS / "normalization.json").read_text())
    calibration = json.loads((ARTIFACTS / "calibration.json").read_text())
    ids = np.asarray(json.loads((ARTIFACTS / "reference-ids.json").read_text()), dtype=np.int64)
    founder_available = np.asarray(json.loads((ARTIFACTS / "reference-founder-availability.json").read_text()), dtype=bool)
    startup_dimensions = int(manifest["startupFeatureDimensions"])
    founder_dimensions = int(manifest["founderFeatureDimensions"])
    startup_bottleneck = int(manifest["startupBottleneckDimensions"])
    founder_bottleneck = int(manifest["founderBottleneckDimensions"])
    reference_dimensions = int(manifest["referenceDimensions"])
    company_count = int(manifest["trainingCompanies"])
    founder_count = int(manifest["founderEvidenceCompanies"])

    assert manifest["version"] == MODEL_VERSION
    assert manifest["runtime"] == "onnx"
    assert manifest["datasetSourceHash"] == source_hash(PUBLIC_DATA, FOUNDER_PROFILES)
    assert manifest["founderFeatureSpecHash"] == hashlib.sha256(FOUNDER_FEATURE_SPEC.read_bytes()).hexdigest()
    assert manifest["scoreWeights"] == {"startup": 0.7, "founder": 0.3}
    assert reference_dimensions == startup_bottleneck + founder_bottleneck
    assert len(normalization["startup"]["mean"]) == len(normalization["startup"]["scale"]) == startup_dimensions
    assert len(normalization["founder"]["mean"]) == len(normalization["founder"]["scale"]) == founder_dimensions
    for branch in ["startup", "founder"]:
        assert np.isfinite(normalization[branch]["mean"]).all()
        assert np.isfinite(normalization[branch]["scale"]).all()
        assert np.asarray(normalization[branch]["scale"]).min() > 0

    startup_calibration = np.asarray(calibration["startup"], dtype=np.float32)
    founder_calibration = np.asarray(calibration["founder"], dtype=np.float32)
    assert len(startup_calibration) == company_count and finite_sorted(startup_calibration)
    assert len(founder_calibration) == founder_count and finite_sorted(founder_calibration)
    assert len(ids) == company_count and len(np.unique(ids)) == company_count
    assert len(founder_available) == company_count and int(founder_available.sum()) == founder_count

    latent = np.fromfile(ARTIFACTS / "reference-latent.bin", dtype=np.float32)
    assert latent.size == company_count * reference_dimensions
    latent = latent.reshape(company_count, reference_dimensions)
    assert np.isfinite(latent).all()
    directory_companies = json.loads((ARTIFACTS / "directory-companies.json").read_text())
    assert len(directory_companies) == company_count
    assert all(0 <= company["x"] <= 1 and 0 <= company["y"] <= 1 for company in directory_companies)

    rng = np.random.default_rng(manifest["seed"])
    startup_sample = rng.normal(size=(16, startup_dimensions)).astype(np.float32)
    founder_sample = rng.normal(size=(16, founder_dimensions)).astype(np.float32)
    fp32_outputs = infer(ARTIFACTS / "model.fp32.onnx", startup_sample, founder_sample)
    quantized_outputs = infer(ARTIFACTS / "model.onnx", startup_sample, founder_sample)
    expected_shapes = [
        (16, startup_dimensions),
        (16, startup_bottleneck),
        (16, founder_dimensions),
        (16, founder_bottleneck),
    ]
    deltas: list[float] = []
    assert len(fp32_outputs) == len(quantized_outputs) == 4
    for fp32, quantized, expected_shape in zip(fp32_outputs, quantized_outputs, expected_shapes, strict=True):
        assert fp32.shape == quantized.shape == expected_shape
        assert np.isfinite(quantized).all()
        delta = float(np.max(np.abs(fp32 - quantized)))
        assert delta <= 0.15, delta
        deltas.append(delta)
    assert (ARTIFACTS / "model.onnx").stat().st_size < (ARTIFACTS / "model.fp32.onnx").stat().st_size

    print(f"Artifact validation passed. Quantized parity deltas: {', '.join(f'{delta:.6f}' for delta in deltas)}.")
    if args.promote:
        PUBLIC_MODEL.mkdir(parents=True, exist_ok=True)
        for name in [
            "model.onnx",
            "normalization.json",
            "calibration.json",
            "reference-latent.bin",
            "reference-ids.json",
            "reference-founder-availability.json",
            "evaluation.json",
            "manifest.json",
            "directory-companies.json",
        ]:
            shutil.copy2(ARTIFACTS / name, PUBLIC_MODEL / name)
        print(f"Promoted validated v2 artifacts to {PUBLIC_MODEL}; activation remains pending release upload.")


if __name__ == "__main__":
    main()
