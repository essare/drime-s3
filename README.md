# drime-s3

Bun-powered **S3-compatible HTTP gateway** in front of [Drime Cloud](https://drime.cloud). Buckets are **root-level folders** inside a dedicated Drime workspace (default name `drime-s3`). Design: [docs/superpowers/specs/2026-05-09-drime-s3-typescript-port-design.md](docs/superpowers/specs/2026-05-09-drime-s3-typescript-port-design.md).

## Install

```bash
bun install
```

## Quick start (real Drime, local gateway)

1. **Environment**

   - `DRIME_API_KEY` or `API_KEY` — Drime API bearer token (Bun loads `.env` automatically for `bun run`).
   - `DRIME_API_BASE_URL` — optional; default `https://app.drime.cloud/api/v1`.
   - `DRIME_S3_INSECURE=1` or `--insecure` — skips S3 Sig V4 verification (local dev only; do not expose publicly).
   - `DRIME_GATEWAY_WORKSPACE_NAME` — optional; default `drime-s3`.

2. **Create the gateway workspace** (once per Drime account / name):

   ```bash
   export DRIME_API_KEY=your_key_here
   export DRIME_S3_INSECURE=1
   bun run src/cli/main.ts init
   ```

3. **Run the gateway** (listens on `[server]` from config, default `127.0.0.1:8081`):

   ```bash
   bun run start
   # or: bun run src/cli/main.ts serve --port 9000
   ```

4. **Smoke test uploads** (second terminal; hits the live gateway → Drime `/uploads`):

   ```bash
   DRIME_S3_INSECURE=1 bun run smoke:real http://127.0.0.1:8081
   ```

   With Sig V4 enabled (no insecure mode), use any S3 client with `endpoint_url` pointing at this server and credentials from `S3_ACCESS_KEY` / `S3_SECRET_KEY` (set in `~/.config/drime-s3/config.toml` or env).

## CLI

| Command | Purpose |
|--------|---------|
| `bun run src/cli/main.ts init` | Ensure workspace `DRIME_GATEWAY_WORKSPACE_NAME` exists |
| `bun run src/cli/main.ts serve` | Start `Bun.serve` |
| `bun run src/cli/main.ts print-config` | Merged config (secrets redacted) |

Global flags: `--config <path>`, `--insecure`, `--i-know-what-im-doing`, `--host`, `--port`.  
NPM-compatible binary: `bunx drime-s3 serve` (see `package.json` `"bin"`).

Config file default: `~/.config/drime-s3/config.toml` (TOML keys `s3.access_key`, `drime.api_key`, etc.; env overrides in `src/config.ts`).

## Dev

```bash
bun test
bun run typecheck
bun run lint
```

`bun run dev` runs the gateway with `--hot` reload.
