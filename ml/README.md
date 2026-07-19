# Offline fit-model pipeline

The web app performs inference only. Training is an explicit release operation so model changes cannot silently alter existing reports.

1. Run `bun run data:sync`.
2. Run `bun run model:categorize`; it caches conservative structured profiles, resumes from checkpoints, and requires `AI_GATEWAY_API_KEY`.
3. Create a Python 3.12 virtual environment and install `ml/requirements.txt`.
4. Configure the `S3_*` variables shown in `.env.example`.
5. Run `bun run model:train`.

Training now performs the complete release transaction: it writes artifacts, validates quantized parity, promotes the runtime files, creates an ignored ZIP named `<random-uuid>-browser-fit-v1.zip`, uploads it through the configured S3-compatible endpoint, verifies the uploaded size, and replaces `modelArchiveUrl` in `config.ts` with the matching `S3_DOWNLOAD_BASE_URL` custom-domain URL. A validation or upload failure leaves the previous URL unchanged and makes training exit unsuccessfully.

Run `bun run model:upload` to package and upload the currently promoted model without retraining. Run `bun run model:upload -- --dry-run` to create and validate the ZIP locally without uploading or changing `config.ts`. Generated archives are kept under ignored `ml/releases/`.

The S3 bucket must allow cross-origin `GET` requests from the web app's origins. The ZIP may contain the required files at its root or inside one versioned directory.

Training uses only publicly launched companies. Grouped out-of-fold reconstruction errors are used for empirical calibration; the result is a fit score, not an acceptance probability. `evaluation.json` reports batch-wise and sector-wise score distributions, while validation compares quantized ONNX outputs against the FP32 export before promotion.
