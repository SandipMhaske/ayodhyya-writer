# Deployment service (protected backend)

The browser/CMS **never** holds AWS credentials. This tiny service does:

- Accepts `POST /api/deploy` / `/api/rollback` with `Authorization: Bearer <token>`.
- **Roles (spec §30):** `DEPLOY_TOKEN` = Publisher (deploy only); `ADMIN_TOKEN` =
  Infrastructure Admin (deploy + rollback). If `ADMIN_TOKEN` is unset, single-user
  mode: the deploy token covers both (startup warning logged). Separation is enforced
  per-request — a Publisher token on `/api/rollback` gets `403 Requires Infrastructure Administrator.`
- Writes `auth.log` (timestamp, ip, route, role, outcome) and `deployments.log`
  (timestamp, role, version). Tokens, keys, and bodies are never logged.
- Strict CORS (single `ALLOWED_ORIGIN`), payload limits, rate limiting on deploy.
- Runs `aws s3 sync` (atomic: upload-new-first, never delete-live-first) for plain files,
  then uploads pre-compressed `.zst`/`.br`/`.gz` variants with exact `Content-Type` +
  `Content-Encoding` metadata (required — the edge ships `nosniff`), prunes stale variants,
  then `aws cloudfront create-invalidation` for changed paths **and their encoded variants**.
- Appends to `deployments.log` (use CloudWatch in production); never logs tokens/secrets.

## Run

```powershell
$env:DEPLOY_TOKEN = "long-random-token-min-32-chars"   # Publisher
$env:ADMIN_TOKEN = "different-long-random-token"       # Infrastructure Admin (rollback)
$env:AWS_REGION = "ap-south-1"
$env:SITE_BUCKET = "ayodhyya-prod-site"
$env:DISTRIBUTION_ID = "E1234567890ABC"
$env:ALLOWED_ORIGIN = "http://localhost:8080"
$env:DIST_DIR = "../../dist"
npm start
```

In the Writer UI: Settings → Deployment service URL → `http://localhost:8787`.

## IAM (least privilege, attach to the role/user running this service)

- `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on the site bucket only.
- `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation` on the distribution only.
- Prefer an instance/pod role or STS `AssumeRole`; no long-lived keys in code or env files.

## Auth model

RBAC lives in your IdP (Cognito recommended): only `Publisher` may call deploy,
only `Infrastructure Administrator` may change profile/rollback. This service validates
the bearer token; put it behind your IdP-aware gateway for MFA/passkeys/session control.
