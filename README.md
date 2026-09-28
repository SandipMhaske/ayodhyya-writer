# Ayodhyya Writer

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
![Zero dependencies](https://img.shields.io/badge/dependencies-zero-blue.svg)
![Offline-first](https://img.shields.io/badge/offline--first-yes-orange.svg)
![Node 18+](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)

**Write Offline → Manage Locally → Preview Locally → Click Publish → Static Website → AWS → Live.**

Offline-first lightweight publishing CRM + static website builder + one-click AWS deployment.
Zero npm dependencies. Vanilla HTML/CSS/JS. IndexedDB local-first. Testable build engine.

## Quick start (no internet required after clone)

```powershell
# 1. One command (database → build → serve + open browser)
npm start
# ...or on Windows: double-click start-writer.bat (also pinned to your taskbar)
# ...or manually: node tools/preview.mjs --admin, then open http://localhost:8080/index.html

# 2. Or just open index.html directly — all editing works offline.
# 3. Run tests
npm test

# 4. Build the static site from the local database (seeded from seed/ on first run)
node tools/build.mjs

# 5. Preview the generated site (same output that gets deployed)
node tools/preview.mjs
# open http://localhost:8081/
```

## Workflow

```
Open Ayodhyya Writer (offline OK) → Create article → Upload image → Add category/tags
→ Configure SEO → Save → Preview locally → Reconnect → PUBLISH WEBSITE
→ Validate → Build → Optimize → Compress → Deploy S3 → CloudFront → HTTPS → Live
```

No FTP / ZIP upload / S3 console / SSH for the normal publish flow.

## Local content database

`seed/seed-data.json` is only a **first-run seed**. Afterwards content lives in a real database:

- **CLI/desktop:** SQLite file at `data/ayodhyya.db` (one table per collection, JSON rows,
  `node:sqlite` built-in — no extra dependencies). All `build`/`deploy`/`db` commands use it.
- **Browser:** IndexedDB (same repository interface, offline-first).
- **Tests:** in-memory store.

```powershell
node tools/db.mjs --init          # create + seed the database
node tools/db.mjs --stats         # row counts per collection
node tools/db.mjs --articles      # list articles (add --status=Draft)
node tools/db.mjs --export        # JSON backup (no secrets)
node tools/db.mjs --export-xml    # XML backup (no secrets)
node tools/db.mjs --export --password=...   # AES-256-GCM encrypted backup (.enc)
node tools/db.mjs --import-url=https://example.com/article  # fetch → sanitize → save as Draft (canonical points at source; private hosts blocked, --allow-local opts intranet back in; images downloaded, magic-byte verified, localized to /assets/images/, published to dist)
node tools/db.mjs --import --file=backups/backup-....json
node tools/db.mjs --sql="SELECT id, json_extract(data,'$.title') AS title, json_extract(data,'$.status') AS status FROM articles"
```

`data/*.json` collection files, if present, still override the DB for that collection
(useful for hand-editing); otherwise the DB is the source of truth.

## Architecture (CONTENT=DATA, TEMPLATES=CODE, AWS=INFRA, CREDENTIALS=SECRETS)

```
src/
  core/models|utils|validators|services   # domain + business logic (browser + node, no DOM)
  storage/      # IContentRepository: IndexedDB (browser) / SQLite file DB (CLI) / Memory (tests)
  security/     # allowlist HTML sanitizer, upload validation, secret scanner, CSP/headers
  templates/    # tiny {{mustache-ish}} engine + versioned default template package
  seo/          # meta, JSON-LD, sitemap, RSS, robots, health checks
  builder/      # static site generator + incremental manifest + redirects + search index
  optimizer/    # HTML/CSS/JS minify, asset fingerprinting, gzip/brotli artifacts
  media/        # file-signature validation, responsive <picture> generation
  deployment/   # IDeploymentProvider, LocalFilesystem + AWS S3/CloudFront (via backend)
  preview/      # tiny static server (admin + dist)
  ../assets/js/app.js  # admin UI: dashboard, editor, media, templates, site, SEO, deploy
server/deployment-service/  # PROTECTED backend holding AWS creds (never the browser)
infra/cloudformation/static-site.yaml  # S3 + OAC + CloudFront + Route53 + ACM (+WAF)
tools/ build.mjs | preview.mjs | deploy.mjs | new-site.mjs
tests/ (node:test, zero deps)
seed/seed-data.json  # ayodhyya.com + leetcode.ayodhyya.com sample
```

## Security golden rule

- Article HTML is **untrusted data** → allowlist-sanitized on save, import, and build.
  Templates + explicitly configured custom JS are **trusted site-owner code**.
- AWS keys **never** in browser JS, localStorage, IndexedDB, generated HTML, or git.
  Browser calls the protected deployment service, which uses STS least-privilege.
- S3 Block Public Access + CloudFront OAC. No public bucket. HTTPS everywhere.
- Uploads validated by extension + MIME + magic bytes + size + dimensions; SVG strictly sanitized;
  path traversal / ZIP bombs / executables rejected; filenames normalized.
- Auth model: RBAC (Viewer/Author/Editor/Publisher/Admin/Infrastructure Admin);
  publishing and infra actions separately authorized. See `server/deployment-service/README.md`.
- Audit log records login, content, template, deploy, rollback — never passwords/tokens/secrets.

## AWS one-click publish

1. Fill **Deployments → Deployment profile** (siteId, domain, bucket id, distribution id, region).
   Secrets stay in the deployment service env / STS — the UI never stores them.
2. Click **PUBLISH WEBSITE**: detect changes → validate (content/SEO/media/links/secrets) →
   sanitize → apply templates → generate pages/sitemap/RSS/robots/search-index/redirects →
   optimize → minify → fingerprint → compress → manifest → upload changed files →
   CloudFront invalidation (changed paths only) → verify → mark Published → store record.
3. **Deployments** keeps every version (`2026.09.25.1042` style). Rollback = republish prior manifest
   (authorization-protected). Failed deploys never delete the live site first (atomic: build →
   validate → upload new → verify → activate).

Provision infra: deploy `infra/cloudformation/static-site.yaml` (S3+OAC+CloudFront+ACM+Route53),
then run the setup wizard in **Deployments → AWS setup** (validates every value,
generates backend tokens, checks backend health, and exports the deploy command).

Alternative target: `DEPLOY_TARGET=cloudflare node tools/deploy.mjs` publishes to Cloudflare
Pages via the Direct Upload API (`CF_ACCOUNT_ID`, `CF_PROJECT`, `CLOUDFLARE_API_TOKEN` with
Pages Write). Hash-deduped uploads, atomic publishes, no invalidation step; security headers
and redirects ship as native `_headers`/`_redirects`. Rollback uses the same snapshot flow.

## Running under $1/month

Estimate for a low-traffic blog (~10k page views/mo, ~50 MB site):

| Service | Cost | Notes |
|---|---|---|
| Route 53 hosted zone | $0.50/mo fixed | Or $0: `CreateDnsRecord=false` + free external DNS (CNAME → CloudFront `DistributionDomain` output) |
| S3 | ~$0.02–0.05 | Tiny storage/requests; lifecycle expires old versions after 30 days |
| CloudFront | ~$0.05–0.30 | No fixed fee; `PriceClass_100`; immutable fingerprinted assets = high edge-hit rate |
| ACM certificate | $0 | |
| Deploy service | $0 | Runs on your machine at publish time, never as an always-on server |
| **Total** | **~$0.60–0.85** | |

Rules that keep it there (all defaults in the template):

- **WAF stays OFF** — it alone is ~$5/mo. The app already ships CSP/HSTS/security headers + OAC-private bucket instead.
- **Invalidate only changed paths** (first 1,000 paths/mo free) — the deployer never does `/*` unless everything changed.
- **Brotli + zstd at the edge** — the build ships `.zst`/`.br`/`.gz` variants of every text file and a CloudFront Function serves the smallest encoding each browser accepts (~70–85% fewer text bytes vs identity; function costs $0.10/M invocations, ≈$0.001 at 10k views). Already-compressed media (JPG/PNG/WebP/AVIF) is never recompressed.
- **No EC2/RDS/Lambda in the serving path** — requests are `CloudFront → cached HTML`, nothing else to pay for.
- Set a billing alert in the AWS console (Billing → Budgets, $1 actual-cost alert) — budgets-email alerts are the cheapest tripwire.
- Traffic is the only variable: each extra ~10 GB transfer ≈ +$0.85. If traffic grows 10x, the architecture still scales — it just outgrows the $1 envelope.

## PWA / offline

Service worker caches the app shell; connectivity indicator gates only Publish/Deploy.
All writing, preview, search, import/export, backup, and `node tools/build.mjs` work offline.

## Tests

`npm test` — unit (slug, sanitize, template, SEO, feeds, optimizer, hashing),
integration (memory store → build pipeline), security (XSS, SVG, traversal, secrets, open redirect).
