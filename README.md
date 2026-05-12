# drime-s3

**S3-compatible gateway for [Drime Cloud](https://drime.cloud).** Root folders in a Drime workspace become **buckets**; keys and objects behave like S3. Use **AWS CLI**, SDKs, or tools such as Duplicati against your own endpoint, plus a small **web admin UI** at `/_ui/`.

Built with **TypeScript** on **[Bun](https://bun.sh)**. Ships as **Docker images** (Docker Hub and GHCR) and a compiled binary with the UI embedded.

---

## Try it quickly (Docker)

1. Copy **[`docker-compose.yml`](./docker-compose.yml)** and set at least:
   - **`DRIME_API_KEY`** — from your Drime account  
   - **`S3_ACCESS_KEY`** / **`S3_SECRET_KEY`** — *any* secret strings **you** choose (for Sig V4 to this gateway only; not AWS keys)
2. Run:

```bash
docker compose run --rm drime-s3 init   # once: create workspace in Drime
docker compose up -d                   # gateway + UI on host port 8081 by default
```

3. Open **`http://127.0.0.1:8081/_ui/`** (adjust host/port if you changed `ports:`). Change **`WEB_UI_PASSWORD`** and **`WEB_UI_SESSION_SECRET`** before anything public-facing.

**Images:** `docker.io/essayoub/drime-s3` and `ghcr.io/<owner>/drime-s3` — tags like **`main`**, **`v1.x.x`**.

---

## Run from source

Requires **Bun 1.3.x**.

```bash
git clone https://github.com/essare/drime-s3.git && cd drime-s3
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd web
```

Put **`DRIME_API_KEY`** in a `.env` file (optional **`S3_ACCESS_KEY`**, **`S3_SECRET_KEY`**, **`WEB_UI_PASSWORD`**, **`WEB_UI_SESSION_SECRET`**). For local dev only you can use **`DRIME_S3_INSECURE=1`** to skip Sig V4 (never on the public internet).

```bash
bun run src/cli/main.ts init
bun run start              # http://127.0.0.1:8081
# bun run dev              # hot reload
# bun run web:dev          # UI only (Vite)
```

Optional config file: **`~/.config/drime-s3/config.toml`**. Env vars override file values; see **`src/config.ts`** for the full list.

---

## AWS CLI (quick)

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

Examples:

```bash
aws s3 ls
aws s3 mb s3://my-bucket
echo hi > /tmp/h.txt && aws s3 cp /tmp/h.txt s3://my-bucket/h.txt
aws s3 cp s3://my-bucket/h.txt -
```

If **`aws s3 rb`** says the bucket is not empty, empty it first or use **`--force`**.

---

## Other S3 clients

- **Region** must be **`drime`** (not `us-east-1`) or Sig V4 will fail.
- Set the **custom S3 endpoint** to your gateway (hostname + port). With **HTTP**, use a **custom server / hostname** field without duplicating `https://` if the UI adds TLS separately.
- **Docker → host gateway:** often **`http://host.docker.internal:<port>`** (macOS/Windows Docker Desktop).

Use a **recent image** (e.g. **≥ v1.0.4**) if you rely on Duplicati or strict ETag checks.

---

## Debugging & advanced env

For tracing S3 responses (status, ETag, path): **`DRIME_S3_HTTP_TRACE=1`**; add **`DRIME_S3_HTTP_TRACE_VERBOSE=1`** for full response headers. **`LOG_LEVEL`**, **`DRIME_S3_PORT`**, **`DRIME_S3_CONTENT_ETAG_BUFFER_BYTES`**, etc. are documented in **`src/config.ts`** and **`.env.example`**.

---

## Contributing & legal

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** and **[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)**. Add a **`LICENSE`** in the repo root when you pick a license.
