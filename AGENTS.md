# Repository Guidelines

## Project structure

- `app/` contains the Next.js routes and API handlers.
- `components/` contains the application UI.
- `lib/` contains shared server, browser, database, and model-loading code.
- `workers/fit-model.worker.ts` owns browser-side model inference.
- `ml/` contains offline training, validation, generated artifacts, and release documentation.
- `scripts/` contains data preparation and model release utilities.
- `config.ts` is the source of truth for the active model version and public model archive URL.
- Turso is the runtime source of truth for the YC directory; `public/data/yc-companies.json` is an ignored offline export only.

## Development commands

```bash
bun run dev
bun run typecheck
bun run test
bun run build
bun run yc:seed
bun run yc:sync
bun run yc:export
```

Use `bun run model:upload -- --dry-run --model-version browser-fit-v2` to verify v2 packaging locally without changing external state, active configuration, or directory coordinates.

## YC directory and semantic search contract

- `bun run yc:seed` and `bun run yc:sync` require an explicit remote Turso URL and add only stable YC IDs that are not already stored. They must never silently write to `local.db`.
- Seed from the complete `yc-oss/api` feed, include 2020 through the current UTC year, and discover batch names from the source. Do not hardcode future season names or import next-year placeholder rows early.
- The YC numeric ID is the deduplication key. Slugs, names, descriptions, hiring state, and other public fields can change.
- Generate stored company vectors and query vectors with the same configured embedding model and fixed dimension. Never mix embedding models in one vector column.
- Enforce the durable per-client quota on the anonymous semantic-search route before calling the paid embedding model; filter-only directory requests do not consume it.
- Runtime company search, exact lookups, report rendering, and browser model inputs read through the Turso-backed directory API/repository. Do not restore browser or server search over the offline JSON export.
- `bun run yc:export` materializes the ignored JSON and manifest only for offline categorization, founder enrichment, training, validation, and release tooling.
- The live searchable directory version and promoted fit-model dataset version are separate contracts. A newly synced company is searchable but is not model-backed until the offline model pipeline is rerun and released.

## Model training and release contract

- Never commit raw or packaged model artifacts. `ml/artifacts/`, `public/models/`, and `ml/releases/` must remain ignored by Git.
- The browser downloads one ZIP using `appConfig.modelArchiveUrl` in `config.ts` and expands the required runtime files in memory. Do not restore individual public model URLs or commit ONNX files as web assets.
- Every release ZIP contains `model.onnx`, `normalization.json`, `calibration.json`, `reference-latent.bin`, `reference-ids.json`, `evaluation.json`, and `manifest.json` under the model-version directory. Founder-aware releases additionally require `reference-founder-availability.json`.
- Release object names use `<random-uuid>-<model-version>.zip`, optionally beneath `S3_PREFIX`. Unique names are intentional so new releases do not reuse stale CDN objects.
- `scripts/release-model.ts` owns manifest-driven packaging, coordinate/reference validation, S3 upload, uploaded-size verification, custom-domain URL construction, transactional Turso coordinate activation, and `config.ts` activation. Keep these steps together so a failed validation, coordinate update, or local activation cannot replace the working release.
- `ml/train.py` owns the full release sequence: train, write artifacts, validate, promote, invoke `model:upload`, and fail the command if any stage fails.
- `bun run model:upload` uploads the currently promoted model, updates model-backed Turso coordinates, and updates `config.ts` without retraining. It mutates S3, Turso, and local configuration; only run it when activation is intended.
- `bun run model:train` also mutates S3, Turso, and `config.ts` after successful training. Do not use it as a read-only validation command.
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
