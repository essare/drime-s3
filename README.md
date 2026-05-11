# drime-s3

**drime-s3** is a self-hosted **S3-compatible HTTP gateway** for [Drime Cloud](https://drime.cloud). It maps a dedicated Drime workspace into an S3-shaped API: **root-level folders become buckets**, objects follow normal S3 semantics, and common tools (AWS CLI, SDKs, presigned URLs) can talk to Drime through a familiar endpoint. A **web admin UI** handles workspace setup, buckets, uploads, and day-to-day operations alongside the S3 API.

The server is written in **TypeScript** and runs on **[Bun](https://bun.sh)**. Releases ship as a **single compiled binary** plus embedded static UI, and as **container images** for Docker-friendly deployments.

---

## Deploy with Docker Compose

Prebuilt images are published on **Docker Hub** (`docker.io/essayoub/drime-s3`) and **GitHub Container Registry** (`ghcr.io/essare/drime-s3`). Rolling builds use tags such as `main` and `sha-<short>`; stable releases use semver tags (for example `v1.2.3` and `1.2.3`).

Create **`docker-compose.yml`** in an empty directory (or use the same file from the repository root if you cloned the project) with the following contents. Put a **`.env`** file in that directory; variables are listed in step 1.

```yaml
# drime-s3 — single-service stack. Create `.env` next to this file, then:
#   docker compose run --rm drime-s3 init   # once per Drime workspace name
#   docker compose up -d

services:
  drime-s3:
    image: ${DRIME_S3_IMAGE:-docker.io/essayoub/drime-s3:main}
    container_name: drime-s3
    restart: unless-stopped
    ports:
      - "${DRIME_S3_PORT:-8081}:8081"
    environment:
      DRIME_API_KEY: ${DRIME_API_KEY:?Set DRIME_API_KEY in .env (see .env.example)}
      DRIME_API_BASE_URL: ${DRIME_API_BASE_URL:-https://app.drime.cloud/api/v1}
      DRIME_GATEWAY_WORKSPACE_NAME: ${DRIME_GATEWAY_WORKSPACE_NAME:-drime-s3}
      DRIME_GATEWAY_WORKSPACE_ID: ${DRIME_GATEWAY_WORKSPACE_ID:-}
      S3_ACCESS_KEY: ${S3_ACCESS_KEY:?Set S3_ACCESS_KEY in .env}
      S3_SECRET_KEY: ${S3_SECRET_KEY:?Set S3_SECRET_KEY in .env}
      WEB_UI_PASSWORD: ${WEB_UI_PASSWORD:?Set WEB_UI_PASSWORD in .env}
      WEB_UI_SESSION_SECRET: ${WEB_UI_SESSION_SECRET:?Set WEB_UI_SESSION_SECRET in .env (hex, 32+ chars)}
      DRIME_S3_INSECURE: ${DRIME_S3_INSECURE:-}
```

### 1. Configure environment

If you cloned the repo, you can start from the tracked template:

```bash
cp .env.example .env
```

Otherwise create **`.env`** manually in the same directory as `docker-compose.yml`. Set at least **`DRIME_API_KEY`**, **`S3_ACCESS_KEY`**, **`S3_SECRET_KEY`**, **`WEB_UI_PASSWORD`**, and **`WEB_UI_SESSION_SECRET`** (hex string, at least 32 characters).

| Variable | Purpose |
|----------|---------|
| `DRIME_API_KEY` | Drime API bearer token |
| `DRIME_API_BASE_URL` | Optional; default `https://app.drime.cloud/api/v1` |
| `DRIME_GATEWAY_WORKSPACE_NAME` | Workspace whose root folders map to buckets (default `drime-s3`) |
| `DRIME_GATEWAY_WORKSPACE_ID` | Optional; pin workspace id and skip discovery |
| `S3_ACCESS_KEY` | Access key id for Sig V4 (use with AWS CLI / SDKs) |
| `S3_SECRET_KEY` | Secret key for Sig V4 |
| `WEB_UI_PASSWORD` | Password for the browser admin UI |
| `WEB_UI_SESSION_SECRET` | Hex string, **at least 32 characters** (16 bytes), for signed cookies |
| `DRIME_S3_IMAGE` | Optional; override image (default `docker.io/essayoub/drime-s3:main`) |
| `DRIME_S3_PORT` | Optional; host port published to the container’s `8081` (default `8081`) |

Run with **Sig V4 enabled** (default): do **not** set `DRIME_S3_INSECURE` in production. For **local or lab use only**, you may set `DRIME_S3_INSECURE=1` in `.env` so missing S3 keys are auto-generated; **never** expose that on the public internet.

### 2. Initialize the workspace (once per Drime account / workspace name)

```bash
docker compose run --rm drime-s3 init
```

### 3. Start the gateway

```bash
docker compose up -d
```

The gateway listens on **`http://127.0.0.1:${DRIME_S3_PORT:-8081}`** on the host. Health: `GET /_health`. Admin UI: **`http://127.0.0.1:${DRIME_S3_PORT:-8081}/_ui/`** (use your host and published port if they differ).

Logs:

```bash
docker compose logs -f drime-s3
```

Stop:

```bash
docker compose down
```

---

## AWS CLI examples

Point the AWS CLI at drime-s3 with **`--endpoint-url`** and use the same **`S3_ACCESS_KEY`** / **`S3_SECRET_KEY`** as in your `.env`. The gateway’s default S3 region is **`drime`** (override in config if you changed `[s3].region`).

For **localhost** and custom endpoints, path-style addressing is reliable:

```bash
export AWS_ACCESS_KEY_ID="your_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="your_S3_SECRET_KEY"
export AWS_DEFAULT_REGION="drime"
export AWS_EC2_METADATA_DISABLED="true"
export AWS_USE_PATH_STYLE_ENDPOINT="true"

ENDPOINT="http://127.0.0.1:8081"
```

### List buckets

```bash
aws s3 ls --endpoint-url "$ENDPOINT"
```

### Create a bucket (S3 “bucket” = root-level folder in Drime)

```bash
aws s3 mb "s3://my-demo-bucket" --endpoint-url "$ENDPOINT"
```

### Upload and download objects

```bash
echo "hello" > /tmp/hello.txt
aws s3 cp /tmp/hello.txt "s3://my-demo-bucket/hello.txt" --endpoint-url "$ENDPOINT"
aws s3 cp "s3://my-demo-bucket/hello.txt" - --endpoint-url "$ENDPOINT"
```

### List objects in a bucket

```bash
aws s3 ls "s3://my-demo-bucket/" --endpoint-url "$ENDPOINT"
```

### Delete an object and the bucket

```bash
aws s3 rm "s3://my-demo-bucket/hello.txt" --endpoint-url "$ENDPOINT"
aws s3 rb "s3://my-demo-bucket" --endpoint-url "$ENDPOINT"
```

If `rb` fails because the bucket is not empty, use `aws s3 rb "s3://my-demo-bucket" --force --endpoint-url "$ENDPOINT"` (this deletes all objects under the prefix first).

### Low-level API (optional)

```bash
aws s3api list-buckets --endpoint-url "$ENDPOINT"
aws s3api head-bucket --bucket my-demo-bucket --endpoint-url "$ENDPOINT"
```

---

## Run locally (from source)

**Requirements:** [Bun](https://bun.sh) **1.3.x** (aligned with the project lockfile and Docker build).

### Install

```bash
git clone https://github.com/essare/drime-s3.git
cd drime-s3
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd web
```

### Environment (minimal)

- `DRIME_API_KEY` or `API_KEY` — Drime API token (Bun loads `.env` when present).
- `DRIME_API_BASE_URL` — optional; default `https://app.drime.cloud/api/v1`.
- `DRIME_GATEWAY_WORKSPACE_NAME` — optional; default `drime-s3`.
- `DRIME_S3_INSECURE=1` or `--insecure` — skips Sig V4 verification (**development only**).

With Sig V4 enabled, set `S3_ACCESS_KEY` and `S3_SECRET_KEY` (or define `[s3]` in the config file below). For the admin UI in production-like mode, set `WEB_UI_PASSWORD` and `WEB_UI_SESSION_SECRET` (hex, at least 32 characters).

### Initialize and serve

```bash
export DRIME_API_KEY=your_key_here
export DRIME_S3_INSECURE=1   # dev only; omit in production
bun run src/cli/main.ts init
bun run start                # default bind 127.0.0.1:8081
# or: bun run src/cli/main.ts serve --host 0.0.0.0 --port 9000
```

### Config file (optional)

Default path: `~/.config/drime-s3/config.toml`. TOML keys include `s3.access_key`, `s3.secret_key`, `drime.api_key`, `web_ui.password`, `web_ui.session_secret`, and `server` host/port. Environment variables override file values (see `src/config.ts`).

### CLI commands

| Command | Purpose |
|---------|---------|
| `bun run src/cli/main.ts init` | Ensure the gateway workspace exists |
| `bun run src/cli/main.ts serve` | Start the HTTP server |
| `bun run src/cli/main.ts print-config` | Print merged config (secrets redacted) |

Global flags include `--config`, `--insecure`, `--host`, and `--port`. The package also exposes a `drime-s3` binary via `package.json` `"bin"`.

### Development server

```bash
bun run dev                  # gateway with hot reload
bun run web:dev              # SPA only (Vite)
```

### Smoke test (insecure, against a running gateway)

```bash
DRIME_S3_INSECURE=1 bun run smoke:real http://127.0.0.1:8081
```

---

## Contributing

Contributions are welcome. Please read **[CONTRIBUTING.md](./CONTRIBUTING.md)** for branch workflow, quality checks, and pull request expectations. New pull requests will see **[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)** as a starting outline.

- **Bugs and features:** use the **[issue templates](.github/ISSUE_TEMPLATE/)** when opening an issue on GitHub.
- **Questions:** open a discussion or an issue, depending on how maintainers organize the repository.

---

## Legal

Licensing terms are defined by the repository owners (add a `LICENSE` file in the repo root when you choose a license).
