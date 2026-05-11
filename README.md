# drime-s3

**drime-s3** is a self-hosted **S3-compatible HTTP gateway** for [Drime Cloud](https://drime.cloud). It maps a dedicated Drime workspace into an S3-shaped API: **root-level folders become buckets**, objects follow normal S3 semantics, and common tools (AWS CLI, SDKs, presigned URLs) can talk to Drime through a familiar endpoint. A **web admin UI** handles workspace setup, buckets, uploads, and day-to-day operations alongside the S3 API.

The server is written in **TypeScript** and runs on **[Bun](https://bun.sh)**. Releases ship as a **single compiled binary** plus embedded static UI, and as **container images** for Docker-friendly deployments.

---

## Deploy with Docker

Prebuilt images are published on **Docker Hub** (`docker.io/essayoub/drime-s3`) and **GitHub Container Registry** (`ghcr.io/essare/drime-s3`). Rolling builds use tags such as `main` and `sha-<short>`; stable releases use semver tags (for example `v1.2.3` and `1.2.3`).

### 1. Pull an image

```bash
docker pull docker.io/essayoub/drime-s3:main
# or
docker pull ghcr.io/essare/drime-s3:main
```

Use a **semver tag** instead of `main` when you want a pinned release.

### 2. Configure secrets (production)

Run with **Sig V4 enabled** (default): set **Drime** and **S3 signing** credentials, and **web UI** secrets. Do **not** set `DRIME_S3_INSECURE` in production.

| Variable | Purpose |
|----------|---------|
| `DRIME_API_KEY` or `API_KEY` | Drime API bearer token |
| `DRIME_API_BASE_URL` | Optional; default `https://app.drime.cloud/api/v1` |
| `DRIME_GATEWAY_WORKSPACE_NAME` | Workspace whose root folders map to buckets (default `drime-s3`) |
| `DRIME_GATEWAY_WORKSPACE_ID` | Optional; pin workspace id and skip discovery |
| `S3_ACCESS_KEY` | Access key id presented to S3 clients |
| `S3_SECRET_KEY` | Secret key for Sig V4 |
| `WEB_UI_PASSWORD` | Password for the browser admin UI |
| `WEB_UI_SESSION_SECRET` | Hex string, **at least 32 characters** (16 bytes), for signed cookies |

Optional listening overrides: `DRIME_S3_HOST`, `DRIME_S3_PORT` (the image defaults to listening on `8081` inside the container).

### 3. Initialize the workspace (once per Drime account / name)

```bash
docker run --rm \
  -e DRIME_API_KEY="your_drime_api_token" \
  -e S3_ACCESS_KEY="your_access_key" \
  -e S3_SECRET_KEY="your_secret_key" \
  -e WEB_UI_PASSWORD="choose_a_strong_password" \
  -e WEB_UI_SESSION_SECRET="00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff" \
  docker.io/essayoub/drime-s3:main \
  init
```

### 4. Run the gateway

```bash
docker run -d --name drime-s3 -p 8081:8081 \
  -e DRIME_API_KEY="your_drime_api_token" \
  -e S3_ACCESS_KEY="your_access_key" \
  -e S3_SECRET_KEY="your_secret_key" \
  -e WEB_UI_PASSWORD="choose_a_strong_password" \
  -e WEB_UI_SESSION_SECRET="00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff" \
  docker.io/essayoub/drime-s3:main
```

The process listens on **port 8081** (`/_health` is used for the container health check). Point your S3 client’s `endpoint_url` at `http://<host>:8081` (or HTTPS if you terminate TLS in front of the container). Open **`http://<host>:8081/_ui/`** for the admin UI.

For **local or lab use only**, you may set `DRIME_S3_INSECURE=1` so missing S3 keys are auto-generated; **never** expose that mode on the public internet.

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
