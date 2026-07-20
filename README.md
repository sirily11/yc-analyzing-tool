# Application Signal

Application Signal is an independent YC-inspired startup explorer and private business-plan analysis workspace. It maps public YC companies from 2022–2026 YTD and produces a **YC Fit Score**, never an acceptance probability.

## Local setup

```bash
bun install
cp .env.example .env.local
bun run db:migrate
bun run dev
```

For a local authenticated preview, set `DEV_BYPASS_AUTH=true`. This flag is ignored in production. Production uses `@rxtech-lab/authjs-rxlab` with the RxLab OIDC values in `.env.example`, Turso with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, and Vercel AI Gateway with `AI_GATEWAY_API_KEY`. `AI_TITLE_MODEL` selects the lightweight model used to generate each new chat's title asynchronously from its first user message.

## Data and privacy

- `bun run data:sync` refreshes the compact public directory asset from `yc-oss/api` and writes a versioned manifest.
- PDF text extraction occurs in the browser. The original PDF and extracted representation are uploaded through short-lived signed URLs to the configured S3 bucket under `S3_DOCUMENT_PREFIX`.
- Turso stores owner-scoped object references, chat UI parts, structured profiles, model results, and reports. Restored approval requests resolve their document through the owner and conversation scope instead of browser memory.
- Deleting a conversation deletes its retained S3 objects before removing its messages and reports. Reports and PDF downloads repeat the same ownership check.

## Research-enriched final reports

New YC Fit reports lock the browser-generated score, research the five closest public YC-company neighbors, and then draft a citation-backed coaching dossier. Configure `AI_REPORT_MODEL` independently from chat/profile extraction and provide `FIRECRAWL_API_KEY`. In production, `FIRECRAWL_WEBHOOK_SECRET` plus a public HTTPS `NEXT_PUBLIC_SITE_URL` enables prompt background completion. Without them, the report progress page uses authenticated Firecrawl status API polling, which is also the local-development and recovery path.

Firecrawl receives only public comparable-company names and URLs. It never receives the founder's PDF or typed brief. Website crawls are HTTPS-only, capped at five pages, restricted to the official domain, and respect robots.txt. Completed reports retain structured findings and a source index rather than raw crawled page content. If Firecrawl or the drafting model is unavailable, the locked score is preserved and an expanded deterministic dossier is published with an explicit warning.

Server logs use structured `[report-research]` lifecycle events for Firecrawl requests, retries, job submission, polling/webhooks, credit counts, coverage, drafting, and fallbacks. Logs intentionally exclude API keys, source URLs, crawled page contents, and candidate documents.

## YC company research and cluster maps

Chat can search and filter the versioned 2022–2026 public YC directory, inspect exact company profiles, and compare up to ten companies. Local directory lookup is immediate. Current-web research, dynamic mapping, and private report persistence share one explicit `company-research` approval and the same hourly analysis limit as application reports.

Configure `FIRECRAWL_API_KEY` to enable research. Each company is limited to three public search results and three same-origin official pages. The server keeps structured summaries, cited claims, source metadata, and coverage warnings; it does not persist scraped Markdown. A report fails visibly when all live research operations fail.

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

The full training command validates and promotes the artifacts, creates `ml/releases/<random-uuid>-browser-fit-v2.zip`, uploads it through the S3-compatible endpoint, verifies the uploaded byte count, and atomically activates the model version, dataset version, archive URL, and learned directory coordinates. If validation, upload, or local activation fails, the previously configured model remains active.

```bash
# Train, validate, package, upload, and update config.ts
bun run model:train

# Resume public YC founder-page enrichment and conservative categorization
bun run model:founders

# Package and upload the currently promoted model without retraining
bun run model:upload

# Package locally without uploading or changing config.ts
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
