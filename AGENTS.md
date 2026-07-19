# Repository Guidelines

## Project structure

- `app/` contains the Next.js routes and API handlers.
- `components/` contains the application UI.
- `lib/` contains shared server, browser, database, and model-loading code.
- `workers/fit-model.worker.ts` owns browser-side model inference.
- `ml/` contains offline training, validation, generated artifacts, and release documentation.
- `scripts/` contains data preparation and model release utilities.
- `config.ts` is the source of truth for the active model version and public model archive URL.

## Development commands

```bash
bun run dev
bun run typecheck
bun run test
bun run build
```

Use `bun run model:upload -- --dry-run` to verify model packaging locally without changing external state or `config.ts`.

## Model training and release contract

- Never commit raw or packaged model artifacts. `ml/artifacts/`, `public/models/`, and `ml/releases/` must remain ignored by Git.
- The browser downloads one ZIP using `appConfig.modelArchiveUrl` in `config.ts` and expands the required runtime files in memory. Do not restore individual public model URLs or commit ONNX files as web assets.
- A release ZIP must contain `model.onnx`, `normalization.json`, `calibration.json`, `reference-latent.bin`, `reference-ids.json`, `evaluation.json`, and `manifest.json` under the model-version directory.
- Release object names use `<random-uuid>-<model-version>.zip`, optionally beneath `S3_PREFIX`. Unique names are intentional so new releases do not reuse stale CDN objects.
- `scripts/release-model.ts` owns packaging, S3 upload, uploaded-size verification, custom-domain URL construction, and the atomic `config.ts` update. Keep these steps together so a failed validation or upload cannot replace the working URL.
- `ml/train.py` owns the full release sequence: train, write artifacts, validate, promote, invoke `model:upload`, and fail the command if any stage fails.
- `bun run model:upload` uploads the currently promoted model and updates `config.ts` without retraining. It mutates S3 and local configuration; only run it when an upload is intended.
- `bun run model:train` also mutates S3 and `config.ts` after successful training. Do not use it as a read-only validation command.
- Keep the detailed workflow synchronized between this file, `README.md`, `ml/README.md`, `.env.example`, and `package.json` whenever release behavior changes.

## S3 configuration

Model releases use Bun's native S3-compatible client and the following `.env` variables:

- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_PREFIX` (optional object-key prefix)
- `S3_DOCUMENT_PREFIX` (optional chat-PDF object-key prefix; defaults to `chat-documents` in the same bucket)
- `S3_DOWNLOAD_BASE_URL` (public custom-domain base for the bucket root)

Never print credentials or copy their values into tracked files. Public model downloads require cross-origin `GET` access. Direct chat-PDF uploads require cross-origin `PUT` access from the deployed application origin; upload bodies intentionally use no custom request headers.

## Verification

- Add or update focused tests when changing archive contents, object-key construction, custom-domain URL construction, or `config.ts` replacement behavior.
- Run `bun run typecheck` and `bun run test` after TypeScript changes.
- Run `python3 -m py_compile ml/train.py ml/validate_artifacts.py` after changing the Python pipeline.
- Use the dry-run upload command for an end-to-end local packaging check. Do not perform a real upload merely to verify code unless explicitly requested.
