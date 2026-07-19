from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "ml" / "artifacts" / "browser-fit-v1"
PUBLIC_MODEL = ROOT / "public" / "models" / "browser-fit-v1"
PUBLIC_DATA = ROOT / "public" / "data" / "yc-companies.json"


def source_hash(path: Path) -> str:
    companies = json.loads(path.read_text())
    source_rows = [{key: value for key, value in company.items() if key not in {"x", "y"}} for company in companies]
    return hashlib.sha256(json.dumps(source_rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def infer(path: Path, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    outputs = session.run(None, {"features": values})
    assert len(outputs) == 2
    return outputs[0], outputs[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--promote", action="store_true", help="Copy validated release artifacts into public/.")
    args = parser.parse_args()

    manifest = json.loads((ARTIFACTS / "manifest.json").read_text())
    normalization = json.loads((ARTIFACTS / "normalization.json").read_text())
    calibration = np.asarray(json.loads((ARTIFACTS / "calibration.json").read_text()), dtype=np.float32)
    ids = np.asarray(json.loads((ARTIFACTS / "reference-ids.json").read_text()), dtype=np.int64)
    dimensions = int(manifest["featureDimensions"])
    bottleneck = int(manifest["bottleneckDimensions"])
    company_count = int(manifest["trainingCompanies"])

    assert manifest["runtime"] == "onnx"
    assert manifest["datasetSourceHash"] == source_hash(PUBLIC_DATA)
    assert len(normalization["mean"]) == dimensions
    assert len(normalization["scale"]) == dimensions
    assert np.isfinite(normalization["mean"]).all()
    assert np.isfinite(normalization["scale"]).all()
    assert np.asarray(normalization["scale"]).min() > 0
    assert len(calibration) == company_count
    assert np.isfinite(calibration).all() and calibration.min() >= 0
    assert np.all(calibration[:-1] <= calibration[1:])
    assert len(ids) == company_count and len(np.unique(ids)) == company_count

    latent = np.fromfile(ARTIFACTS / "reference-latent.bin", dtype=np.float32)
    assert latent.size == company_count * bottleneck
    latent = latent.reshape(company_count, bottleneck)
    assert np.isfinite(latent).all()
    directory_companies = json.loads((ARTIFACTS / "directory-companies.json").read_text())
    assert len(directory_companies) == company_count
    assert all(0 <= company["x"] <= 1 and 0 <= company["y"] <= 1 for company in directory_companies)

    rng = np.random.default_rng(manifest["seed"])
    sample = rng.normal(size=(16, dimensions)).astype(np.float32)
    fp32_reconstruction, fp32_latent = infer(ARTIFACTS / "model.fp32.onnx", sample)
    quantized_reconstruction, quantized_latent = infer(ARTIFACTS / "model.onnx", sample)
    assert fp32_reconstruction.shape == quantized_reconstruction.shape == (16, dimensions)
    assert fp32_latent.shape == quantized_latent.shape == (16, bottleneck)
    assert np.isfinite(quantized_reconstruction).all() and np.isfinite(quantized_latent).all()
    reconstruction_delta = float(np.max(np.abs(fp32_reconstruction - quantized_reconstruction)))
    latent_delta = float(np.max(np.abs(fp32_latent - quantized_latent)))
    assert reconstruction_delta <= 0.15, reconstruction_delta
    assert latent_delta <= 0.15, latent_delta
    assert (ARTIFACTS / "model.onnx").stat().st_size < (ARTIFACTS / "model.fp32.onnx").stat().st_size

    print(f"Artifact validation passed. Quantized parity deltas: reconstruction={reconstruction_delta:.6f}, latent={latent_delta:.6f}.")
    if args.promote:
        PUBLIC_MODEL.mkdir(parents=True, exist_ok=True)
        for name in ["model.onnx", "normalization.json", "calibration.json", "reference-latent.bin", "reference-ids.json", "evaluation.json", "manifest.json"]:
            shutil.copy2(ARTIFACTS / name, PUBLIC_MODEL / name)
        shutil.copy2(ARTIFACTS / "directory-companies.json", PUBLIC_DATA)
        print(f"Promoted validated artifacts to {PUBLIC_MODEL} and learned coordinates to {PUBLIC_DATA}.")


if __name__ == "__main__":
    main()
