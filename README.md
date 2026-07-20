# Application Signal

Application Signal is an independent YC-inspired startup explorer and private business-plan analysis workspace. Its Turso-backed directory covers public YC companies from 2020 through the current year and produces a **YC Fit Score**, never an acceptance probability.

## Local setup

```bash
bun install
cp .env.example .env.local
bun run db:migrate
bun run yc:seed
bun run dev
```

Set an explicit remote `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `AI_GATEWAY_API_KEY` before the migration and one-time seed; the YC directory intentionally has no local-file bootstrap. For a local authenticated preview, set `DEV_BYPASS_AUTH=true`. This flag is ignored in production. Production uses `@rxtech-lab/authjs-rxlab` with the RxLab OIDC values in `.env.example`. `AI_TITLE_MODEL` selects the lightweight model used to generate each new chat's title asynchronously from its first user message. `AI_EMBEDDING_MODEL` must remain the same for YC ingestion and query-time semantic search.

## Data and privacy

- `bun run yc:seed` downloads the complete `yc-oss/api` feed, keeps companies from 2020 through the current UTC year, embeds only IDs missing from Turso, and stores the directory plus its manifest in the database.
- `bun run yc:sync` is the idempotent future-update command. It scans the complete feed and adds only new stable YC IDs, so newly published batches are discovered without hardcoded season names.
- `bun run yc:export` writes an ignored `public/data/yc-companies.json` plus `manifest.json` from Turso only for offline model training and release work. The deployed app never searches or reads that JSON.
- PDF text extraction occurs in the browser. The original PDF and extracted representation are uploaded through short-lived signed URLs to the configured S3 bucket under `S3_DOCUMENT_PREFIX`.
- Turso stores owner-scoped object references, chat UI parts, structured profiles, model results, and reports. Restored approval requests resolve their document through the owner and conversation scope instead of browser memory.
- Deleting a conversation deletes its retained S3 objects before removing its messages and reports. Reports and PDF downloads repeat the same ownership check.

## Research-enriched final reports

New YC Fit reports lock the browser-generated score, research the five closest public YC-company neighbors, and then draft a citation-backed coaching dossier. Configure `AI_REPORT_MODEL` independently from chat/profile extraction and provide `FIRECRAWL_API_KEY`. In production, `FIRECRAWL_WEBHOOK_SECRET` plus a public HTTPS `NEXT_PUBLIC_SITE_URL` enables prompt background completion. Without them, the report progress page uses authenticated Firecrawl status API polling, which is also the local-development and recovery path.

Firecrawl receives only public comparable-company names and URLs. It never receives the founder's PDF or typed brief. Website crawls are HTTPS-only, capped at five pages, restricted to the official domain, and respect robots.txt. Completed reports retain structured findings and a source index rather than raw crawled page content. If Firecrawl or the drafting model is unavailable, the locked score is preserved and an expanded deterministic dossier is published with an explicit warning.

Server logs use structured `[report-research]` lifecycle events for Firecrawl requests, retries, job submission, polling/webhooks, credit counts, coverage, drafting, and fallbacks. Logs intentionally exclude API keys, source URLs, crawled page contents, and candidate documents.

## YC company research and cluster maps

Chat and the public explorer use natural-language embedding search over the Turso-backed 2020–current-year YC directory, with optional exact filters. The anonymous public endpoint applies a Turso-backed per-client quota before generating a paid query embedding. They can inspect exact company profiles and compare up to ten companies. Current-web research, dynamic mapping, and private report persistence share one explicit `company-research` approval and the same hourly analysis limit as application reports.

Run migrations before the first seed. Both ingestion commands intentionally require an explicit remote `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `AI_GATEWAY_API_KEY`; they never fall back to `local.db`. The default `openai/text-embedding-3-small` contract stores 1,536-dimensional vectors. Changing that model or dimension requires a deliberate full re-embedding rather than mixing vectors in one index.

Configure `FIRECRAWL_API_KEY` to enable research. Each company is limited to three public search results and three same-origin official pages. The server keeps structured summaries, cited claims, source metadata, and coverage warnings; it does not persist scraped Markdown. A report fails visibly when all live research operations fail.

YC company reports run asynchronously through Vercel Workflow. The authenticated request creates the owner-scoped report row, schedules the durable research run, and returns its private progress URL with HTTP 202. Firecrawl retrieval and AI synthesis execute as retryable Workflow steps; the progress page polls the Turso-backed report status and runs the existing versioned semantic map in the browser once the cited draft reaches `mapping`. Wrap `next.config.ts` with `withWorkflow()` and keep the `workflow` package installed so local development and Vercel deployments register the workflow and step routes.

Dynamic maps run in the browser using the active model archive. They combine normalized startup latent vectors and current website-language embeddings with a deterministic 70/30 distance blend, add at most 40 nearby reference companies, and fall back to the versioned global map with a warning if embedding or UMAP fails. Saved company reports and map inputs are owner-only and do not affect the dashboard's YC Fit average.

## Model training and S3 releases

The raw ONNX model and generated release archives are not committed to Git. Training artifacts, promoted browser artifacts, and packaged releases are ignored under `ml/artifacts/`, `public/models/`, and `ml/releases/` respectively. The browser instead downloads one versioned ZIP from the URL stored as `modelArchiveUrl` in `config.ts` and expands it in memory.

Configure these values in `.env` before releasing a model:

```dotenv
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
S3_ENDPOINT=
S3_REGION=
S3_PREFIX=models
S3_DOCUMENT_PREFIX=chat-documents
S3_DOWNLOAD_BASE_URL=https://models.example.com
```

`S3_DOWNLOAD_BASE_URL` is the public custom-domain base for model archives. `S3_PREFIX` is optional and becomes part of both the model object key and public download URL. Chat PDFs share `S3_BUCKET` but use the separate `S3_DOCUMENT_PREFIX`; their keys are never exposed as public application URLs.

Because the browser uploads PDFs directly through short-lived signed URLs, the S3 bucket must allow cross-origin `PUT` requests from the deployed application origin. Upload bodies are sent as raw bytes without custom request headers, so the CORS policy does not need an `AllowedHeaders` entry. The server downloads and verifies the uploaded byte size, SHA-256 hash, and extracted representation before marking a document ready.

The founder-aware v2 model has independent startup and founder branches. Founder inputs are reduced to controlled job-relevant signals; raw biographies, names, schools, employers, demographics, and prestige never enter the model or release archive. Run `bun run model:founders` before training to resume the YC-hosted biography fetch and structured enrichment checkpoints.

The full training command validates and promotes the artifacts, creates `ml/releases/<random-uuid>-browser-fit-v2.zip`, uploads it through the S3-compatible endpoint, verifies the uploaded byte count, validates learned coordinates against the model reference IDs, updates model-backed coordinates in one Turso transaction, and activates the model version, dataset version, and archive URL in `config.ts`. Failed coordinate or local-config activation rolls back the working release; a uniquely named uploaded archive may remain unused.

```bash
# Seed an empty Turso database with 2020 through the current UTC year
bun run yc:seed

# Add only YC IDs that have appeared since the last seed
bun run yc:sync

# Export the DB directory to ignored local files for offline model work
bun run yc:export

# Train, validate, package, upload, and update config.ts
bun run model:train

# Resume public YC founder-page enrichment and conservative categorization
bun run model:founders

# Package and upload the currently promoted model, then activate Turso coordinates
bun run model:upload

# Package locally without uploading or changing Turso/config.ts
bun run model:upload -- --dry-run --model-version browser-fit-v2
```

See `ml/README.md` for training prerequisites and the detailed offline model workflow.

## Quality checks

```bash
bun run typecheck
bun run test
bun run build
```

The browser scorer loads the validated quantized ONNX release, branch-specific normalization and empirical calibration data, and compact reference latent vectors from the configured model archive. With founder evidence the overall fit is 70% startup fit and 30% founder fit; without it the startup score is preserved unchanged.
