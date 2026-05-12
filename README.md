<p align="center">
  <img src="docs/images/drime-s3-logo.png" width="160" alt="drime-s3 logo" />
</p>

<h1 align="center">drime-s3</h1>

<p align="center">
  <strong>S3-compatible gateway for <a href="https://drime.cloud">Drime Cloud</a></strong><br />
  TypeScript · <a href="https://bun.sh">Bun</a> · Docker · Web admin UI
</p>

<p align="center">
  <a href="https://github.com/essare/drime-s3/actions/workflows/docker-publish.yml"><img src="https://github.com/essare/drime-s3/actions/workflows/docker-publish.yml/badge.svg" alt="Docker publish CI" /></a>
  <a href="https://hub.docker.com/r/essayoub/drime-s3"><img src="https://img.shields.io/docker/v/essayoub/drime-s3/latest?label=Docker%20Hub&logo=docker" alt="Docker Hub version" /></a>
  <a href="https://github.com/essare/drime-s3/pkgs/container/drime-s3"><img src="https://img.shields.io/badge/ghcr.io-package-blue?logo=github" alt="GitHub Container Registry" /></a>
  <a href="https://github.com/essare/drime-s3/blob/main/package.json"><img src="https://img.shields.io/badge/Bun-1.3-000?logo=bun&logoColor=white" alt="Bun 1.3" /></a>
</p>

---

## Features

- **S3-shaped API** — workspace root folders are **buckets**; objects, listing, uploads, and common operations work like S3.
- **Sig V4** — AWS CLI, SDKs, and tools such as **Duplicati** / **restic** can use your gateway with a custom endpoint and region **`drime`**.
- **Web admin UI** — manage workspace init, buckets, objects, and uploads at **`/_ui/`**.
- **Docker-first** — images on **Docker Hub** and **GHCR**.

---

## Run in Docker

Save the following as **`docker-compose.yml`** (same as [`docker-compose.yml`](./docker-compose.yml) in this repository), then edit **`DRIME_API_KEY`**, **`S3_ACCESS_KEY`**, and **`S3_SECRET_KEY`**.

```yaml
# drime-s3 — edit `environment`, then `docker compose up -d`.

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

Then:

```bash
docker compose up -d                    # gateway + UI on host port 8081 by default
```

Open **`http://127.0.0.1:8081/_ui/`** (adjust host/port if you changed `ports:`).

**Images:** `docker.io/essayoub/drime-s3` and `ghcr.io/essare/drime-s3` — tags like **`main`**, **`v1.x.x`**.

---

## Try with AWS CLI

Use region **`drime`**, path-style, and your gateway URL.

**AWS CLI 2.15+** (set once per shell; fix host/port to match your gateway):

```bash
export AWS_ACCESS_KEY_ID="<same as S3_ACCESS_KEY>"
export AWS_SECRET_ACCESS_KEY="<same as S3_SECRET_KEY>"
export AWS_DEFAULT_REGION=drime
export AWS_EC2_METADATA_DISABLED=true
export AWS_USE_PATH_STYLE_ENDPOINT=true
export AWS_ENDPOINT_URL_S3="http://127.0.0.1:8081"
```

**Older CLI:** add **`--endpoint-url http://127.0.0.1:8081`** to each command.

```bash
aws s3 ls
aws s3 mb s3://my-bucket
echo hi > /tmp/h.txt && aws s3 cp /tmp/h.txt s3://my-bucket/h.txt
aws s3 cp s3://my-bucket/h.txt -
```

If **`aws s3 rb`** says the bucket is not empty, empty it first or use **`--force`**.

**Other clients:** set the **custom S3 endpoint** to your gateway; from Docker on the host, **`http://host.docker.internal:<port>`** often works. Prefer a **recent release** (e.g. **≥ v1.0.4**) for strict ETag clients such as Duplicati.

---

## Run from source

Requires **Bun 1.3.x**.

```bash
git clone https://github.com/essare/drime-s3.git && cd drime-s3
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd web
```

Put **`DRIME_API_KEY`** in **`.env`** (optional **`S3_ACCESS_KEY`**, **`S3_SECRET_KEY`**, **`WEB_UI_PASSWORD`**, **`WEB_UI_SESSION_SECRET`**). For local dev only, **`DRIME_S3_INSECURE=1`** skips Sig V4 (never on the public internet).

```bash
bun run src/cli/main.ts init
bun run start              # http://127.0.0.1:8081
# bun run dev              # hot reload
# bun run web:dev          # UI only (Vite)
```

Optional **`~/.config/drime-s3/config.toml`**. Full env list: **`src/config.ts`** and **`.env.example`**. S3 trace logging: **`DRIME_S3_HTTP_TRACE=1`** (add **`DRIME_S3_HTTP_TRACE_VERBOSE=1`** for response headers).

---

## Contributing & legal

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** and **[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)**. Add a **`LICENSE`** in the repo root when you pick a license.
