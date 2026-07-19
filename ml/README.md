# Offline fit-model pipeline

The web app performs inference only. Training is an explicit release operation so model changes cannot silently alter existing reports.

1. Run `bun run data:sync`.
2. Run `bun run model:categorize`; it caches conservative structured profiles, resumes from checkpoints, and requires `AI_GATEWAY_API_KEY`.
3. Run `bun run model:founders`; it resumes public YC founder-page fetches and conservative founder-signal categorization without following external profile links.
4. Create a Python 3.12 virtual environment and install `ml/requirements.txt`.
5. Configure the `S3_*` variables shown in `.env.example`.
6. Run `bun run model:train`.

Training writes a dual-branch `browser-fit-v2` ONNX model, validates quantized parity, promotes the runtime files, creates an ignored ZIP named `<random-uuid>-browser-fit-v2.zip`, uploads it through the configured S3-compatible endpoint, verifies the uploaded size, and atomically activates the manifest's model version, dataset version, custom-domain URL, and learned directory coordinates. A validation, upload, or activation failure leaves the previous active model unchanged and makes training exit unsuccessfully.

Run `bun run model:upload -- --model-version browser-fit-v2` to package and upload the promoted v2 model without retraining. Add `--dry-run` to create and validate the ZIP locally without uploading or changing active configuration or coordinates. Generated archives are kept under ignored `ml/releases/`.

The S3 bucket must allow cross-origin `GET` requests from the web app's origins. The ZIP may contain the required files at its root or inside one versioned directory.

Training uses only publicly launched companies. Grouped out-of-fold reconstruction errors independently calibrate startup and founder fit; the result is a fit score, not an acceptance probability. Founder evidence produces a transparent 70/30 startup/founder blend, while missing founder evidence preserves startup fit with no penalty. `evaluation.json` reports evidence coverage and branch-wise distributions, while validation compares all quantized ONNX outputs against the FP32 export before promotion.
