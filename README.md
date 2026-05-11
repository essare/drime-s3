# drime-s3

**drime-s3** is a self-hosted **S3-compatible HTTP gateway** for [Drime Cloud](https://drime.cloud). It maps a dedicated Drime workspace into an S3-shaped API: **root-level folders become buckets**, objects follow normal S3 semantics, and common tools (AWS CLI, SDKs, presigned URLs) can talk to Drime through a familiar endpoint. A **web admin UI** handles workspace setup, buckets, uploads, and day-to-day operations alongside the S3 API.

The server is written in **TypeScript** and runs on **[Bun](https://bun.sh)**. Releases ship as a **single compiled binary** plus embedded static UI, and as **container images** for Docker-friendly deployments.

---

## Deploy with Docker Compose

Prebuilt images are published on **Docker Hub** (`docker.io/essayoub/drime-s3`) and **GitHub Container Registry** (`ghcr.io/essare/drime-s3`). Rolling builds use tags such as `main` and `sha-<short>`; stable releases use semver tags (for example `v1.2.3` and `1.2.3`).

Create **`docker-compose.yml`** (or use the copy in the repository root) and replace at least **`DRIME_API_KEY`** and your chosen **`S3_ACCESS_KEY`** / **`S3_SECRET_KEY`**. No separate **`.env`** file is required for this layout.

**Where values come from:** **`DRIME_API_KEY`** is issued by **Drime** (your account). **`S3_ACCESS_KEY`** and **`S3_SECRET_KEY`** are **not** from Drime or AWS—you **invent** them (any strong strings you keep secret). They are the username/password Sig V4 clients (AWS CLI, SDKs, other apps) use against *this* gateway only. **`WEB_UI_PASSWORD`** defaults to **`changeme`** and **`WEB_UI_SESSION_SECRET`** to a fixed **64-character hex** string so the stack runs out of the box—**change both before any real deployment** (session secret must stay hex; use e.g. `openssl rand -hex 32`).

```yaml
# drime-s3 — edit `environment` values below, then:
#   docker compose run --rm drime-s3 init
#   docker compose up -d

services:
  drime-s3:
    image: docker.io/essayoub/drime-s3:main
    container_name: drime-s3
    restart: unless-stopped
    ports:
      - "8081:8081"
    environment:
      DRIME_API_KEY: "YOUR_DRIME_API_TOKEN"
      DRIME_API_BASE_URL: "https://app.drime.cloud/api/v1"
      DRIME_GATEWAY_WORKSPACE_NAME: "drime-s3"
      # Pick any secret strings; clients use them for Sig V4 here — not from Drime or AWS
      S3_ACCESS_KEY: "YOUR_S3_ACCESS_KEY"
      S3_SECRET_KEY: "YOUR_S3_SECRET_KEY"
      # Dev defaults — change before production
      WEB_UI_PASSWORD: "changeme"
      # Dev default only — rotate in production (64 hex chars = 32 bytes)
      WEB_UI_SESSION_SECRET: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
```

### 1. Configure `environment`

| Key | Purpose |
|-----|---------|
| `DRIME_API_KEY` | Drime API bearer token |
| `DRIME_API_BASE_URL` | Drime API base URL (default shown above) |
| `DRIME_GATEWAY_WORKSPACE_NAME` | Workspace whose root folders map to buckets |
| `S3_ACCESS_KEY` | **You choose** this string; S3 clients send it as the access key id for Sig V4 to this gateway (not from Drime or AWS) |
| `S3_SECRET_KEY` | **You choose** this string; paired secret for Sig V4 (not from Drime or AWS) |
| `WEB_UI_PASSWORD` | Browser admin UI password; defaults to **`changeme`** (change for production) |
| `WEB_UI_SESSION_SECRET` | Hex session signing key, **at least 32 characters**; defaults to a **dev-only** 64-hex string in the snippet (rotate for production; e.g. `openssl rand -hex 32`) |

Run with **Sig V4 enabled** (default): omit **`DRIME_S3_INSECURE`**. For **local or lab use only**, add `DRIME_S3_INSECURE: "1"` under `environment` so missing S3 keys are auto-generated; **never** expose that on the public internet.

### 2. Initialize the workspace (once per Drime account / workspace name)

```bash
docker compose run --rm drime-s3 init
```

### 3. Start the gateway

```bash
docker compose up -d
```

The gateway listens on **`http://127.0.0.1:8081`** on the host by default (match the left side of `ports:` if you changed it). Health: `GET /_health`. Admin UI: **`http://127.0.0.1:8081/_ui/`** (adjust host and port to match your `ports:` mapping).

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

Set credentials to the **same `S3_ACCESS_KEY` and `S3_SECRET_KEY` values you chose** in `docker-compose.yml`. The gateway’s default S3 region is **`drime`**.

With **AWS CLI 2.15+**, set a default S3 endpoint once per shell so you do not need **`--endpoint-url`** on every command (adjust host/port if your gateway is not on `127.0.0.1:8081`):

```bash
export AWS_ACCESS_KEY_ID="your_chosen_access_key"
export AWS_SECRET_ACCESS_KEY="your_chosen_secret_key"
export AWS_DEFAULT_REGION="drime"
export AWS_EC2_METADATA_DISABLED="true"
export AWS_USE_PATH_STYLE_ENDPOINT="true"
export AWS_ENDPOINT_URL_S3="http://127.0.0.1:8081"
```

Older CLIs: add **`--endpoint-url http://127.0.0.1:8081`** to each `aws s3` / `aws s3api` invocation (or upgrade the AWS CLI).

### List buckets

```bash
aws s3 ls
```

### Create a bucket (S3 “bucket” = root-level folder in Drime)

```bash
aws s3 mb "s3://my-demo-bucket"
```

### Upload and download objects

```bash
echo "hello" > /tmp/hello.txt
aws s3 cp /tmp/hello.txt "s3://my-demo-bucket/hello.txt"
aws s3 cp "s3://my-demo-bucket/hello.txt" -
```

### List objects in a bucket

```bash
aws s3 ls "s3://my-demo-bucket/"
```

### Delete an object and the bucket

```bash
aws s3 rm "s3://my-demo-bucket/hello.txt"
aws s3 rb "s3://my-demo-bucket"
```

If `rb` fails because the bucket is not empty, use `aws s3 rb "s3://my-demo-bucket" --force` (this deletes all objects under the prefix first).

### Low-level API (optional)

```bash
aws s3api list-buckets
aws s3api head-bucket --bucket my-demo-bucket
```

### Third-party S3 clients (Duplicati, restic, etc.)

- Set **region** (sometimes labeled *location* or *AWS region*) to **`drime`**. This gateway uses that name in the Sig V4 credential scope; clients that default to **`us-east-1`** will fail with **“The request signature we calculated does not match…”**.
- Use your gateway URL as the **endpoint** (e.g. `http://192.168.2.33:38280`). Enable **path-style** addressing if the client offers it when using a raw IP or custom port.
- **Duplicati** and similar tools often send **`x-amz-content-sha256: UNSIGNED-PAYLOAD`** on PUT; images **before v1.0.1** lowercased that header during verification. Use **`v1.0.1`** or newer (or a `main` image built from that fix).
- **ETag:** some Drime objects have no `md5:` line or `hash` in metadata; older gateways returned **`"unknown"`**, which strict .NET parsers reject (**“Could not find any recognizable digits”**). **v1.0.2+** emits a stable synthetic **32-hex** ETag instead.

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
- `DRIME_S3_HTTP_TRACE=1` — log each S3 response (`method`, `path`, `status`, `etag`, `contentLength`, `requestId`) for correlating third-party clients (e.g. Duplicati) with gateway behavior.
- `LOG_LEVEL` or `PINO_LOG_LEVEL` — Pino log level (`trace`, `debug`, `info`, …); default `info`.

With Sig V4 enabled, set **`S3_ACCESS_KEY`** and **`S3_SECRET_KEY`** to strings **you choose** (they are only for this gateway, not from Drime or AWS), or define `[s3]` in the config file below. For the admin UI, set **`WEB_UI_PASSWORD`** and **`WEB_UI_SESSION_SECRET`** (hex, at least 32 characters); the Docker Compose example in this README uses **`changeme`** and a fixed dev hex string as defaults.

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
