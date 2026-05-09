# drime-s3 Frontend — Admin Web UI Design

**Date:** 2026-05-09
**Status:** Approved (brainstorming complete; ready for implementation planning)
**Author:** Brainstorming session output
**Related:** [2026-05-09-drime-s3-typescript-port-design.md](./2026-05-09-drime-s3-typescript-port-design.md) — gateway design this UI sits on top of.

---

## 1. Goal

Add a self-hosted, browser-based admin UI to the `drime-s3` gateway that lets a single operator:

1. **Onboard** the gateway — verify environment configuration, confirm Drime API connectivity, and bootstrap the gateway workspace.
2. **Manage buckets** — list, create, and delete buckets that map to Drime root folders.
3. **Manage objects inside a bucket** — browse hierarchically, upload via drag-and-drop, download, and delete (single + bulk).
4. **See a dashboard** at the root of the app showing the workspace's bucket count and overall health.

The UI runs as part of the existing `Bun.serve` process — same binary, same port, same docker image — and reuses the gateway's existing `DrimeClient` and S3 handlers internally.

## 2. Non-Goals (v1)

- **Per-bucket and total byte sizes** — listed by the user as "nice to have" and deferred to v1.1. The bucket card layout reserves a slot for a future size sparkline.
- **Multi-user accounts, RBAC, audit log.** Single shared password.
- **In-UI editing of secrets** (`DRIME_API_KEY`, S3 keys, etc.). Configuration is managed via env vars / docker-compose / `~/.config/drime-s3/config.toml`. The UI only reads and reports status.
- **Object preview / image thumbnails.** v1.1+.
- **Resumable / browser multipart uploads.** Streaming through `/_admin` is sufficient for v1; the S3 protocol path keeps full multipart for AWS CLI / SDK clients.
- **Object versioning / lifecycle / tagging editors.** Drime has no analog.
- **Light-mode theme switcher.** v1 ships dark by default; toggle is v1.1.
- **i18n.**

## 3. High-level Decisions (Locked In)

| # | Decision | Choice |
|---|---|---|
| 1 | UI ↔ gateway transport | **Control-plane JSON API** at `/_admin/*`, served by the existing `Bun.serve`. Browser never sees the S3 secret; no CORS; no AWS SDK in the bundle. |
| 2 | Auth model | **`WEB_UI_PASSWORD` env var** (passed via docker-compose). Login form posts the password; server compares with `crypto.timingSafeEqual` and issues an HttpOnly, SameSite=Strict, signed cookie. |
| 3 | Frontend stack | **React 19 + Vite 6 + TypeScript + Tailwind v4 + shadcn/ui** + TanStack Query 5 + React Router 6 + zod + sonner. Built into static assets and embedded into the Bun binary. |
| 4 | Onboarding scope | **Read-only env checks + one "Initialize Workspace" action**. No in-UI config editing. |
| 5 | Upload UX (v1) | **Streamed through `PUT /_admin/buckets/:b/objects/*key`** (reuses existing PUT object handler internally). |
| 6 | Bucket sizes (v1) | **Skipped.** Dashboard shows bucket count only. Slot reserved for v1.1. |
| 7 | Onboarding visual | **Vertical Stepper Wizard** (env → drime → workspace, one focus at a time). |
| 8 | Dashboard visual | **Hero count + clickable bucket grid** (Vercel/Cloudflare-style), system status as a quiet subtitle. |
| 9 | Bucket-detail visual | **Drop-anywhere + slide-in upload queue.** Plain shadcn DataTable by default; whole page becomes a drop target on drag; floating queue card shows progress. Toolbar still has an explicit "+ Upload" button. |

## 4. Architecture

### 4.1 Single process, single port, path-based dispatch

`Bun.serve` already runs everything on the configured `[server]` host/port (default `127.0.0.1:8081`). The frontend is added as **extra paths in the same router**, not a second process or port:

```
GET /              → if Accept: text/html and no AWS auth → 302 /_ui/
                   → else → existing handleListBuckets (S3 ListBuckets)
GET /_ui/*         → static SPA assets (built by Vite, embedded in binary)
*   /_admin/*      → JSON control-plane router (new, cookie-authed)
*   /<bucket>/...  → existing S3 handlers (unchanged)
GET /_health       → unchanged (loopback only)
```

The "browser vs S3 client" check at `/` is unambiguous: every S3 request carries either `Authorization: AWS4-HMAC-SHA256` or `X-Amz-*` query params. Browsers never do.

### 4.2 Repo layout additions

```
drime-s3/
├── src/
│   ├── admin/                       # NEW — control-plane router & handlers
│   │   ├── router.ts                # /_admin/* dispatch
│   │   ├── auth.ts                  # password verify, cookie sign/verify, rate limit
│   │   ├── ui-assets.ts             # serves /_ui/* from embedded build (fallback to web/dist on disk)
│   │   ├── handlers/
│   │   │   ├── session.ts           # POST /login, POST /logout, GET /session
│   │   │   ├── health.ts            # GET /health (public)
│   │   │   ├── status.ts            # GET /status (env/drime/workspace)
│   │   │   ├── init.ts              # POST /init
│   │   │   ├── buckets.ts           # CRUD on buckets
│   │   │   └── objects.ts           # list/upload/download/delete/batchDelete
│   │   └── shared.ts                # shared synthetic-Request bridge into existing s3 handlers
│   ├── server.ts                    # MODIFIED — front-of-line dispatch (admin/UI/S3 split)
│   └── ... (everything else unchanged)
├── web/                             # NEW — frontend workspace
│   ├── package.json
│   ├── vite.config.ts               # proxy /_admin and /<bucket>/* → gateway during dev
│   ├── tsconfig.json
│   ├── tailwind.config.ts           # Tailwind v4
│   ├── components.json              # shadcn cli config (style: "new-york")
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── app.tsx                  # routes; auth/onboarding gates
│       ├── lib/
│       │   ├── api.ts               # typed fetch wrapper, zod-parsed responses
│       │   ├── query-keys.ts        # canonical TanStack Query keys
│       │   ├── format.ts            # bytes → human, dates, etc.
│       │   └── session.ts           # /session check + logout helpers
│       ├── hooks/
│       │   ├── use-status.ts
│       │   ├── use-buckets.ts
│       │   ├── use-objects.ts
│       │   └── use-auth.ts
│       ├── components/
│       │   ├── ui/                  # shadcn-generated primitives
│       │   ├── layout/{shell,sidebar,topbar}.tsx
│       │   ├── onboarding/{stepper,step-cards}.tsx
│       │   ├── buckets/{bucket-table,new-bucket-dialog,delete-bucket-dialog}.tsx
│       │   └── objects/{object-table,breadcrumbs,upload-dropzone,delete-objects-dialog,upload-queue}.tsx
│       └── pages/
│           ├── login.tsx
│           ├── onboarding.tsx
│           ├── dashboard.tsx
│           ├── buckets.tsx
│           ├── bucket-detail.tsx
│           └── not-found.tsx
└── package.json                     # add web:dev / web:build / web:lint scripts
```

No new runtime server dependencies. Frontend dependencies live in `web/` and never reach the gateway runtime.

### 4.3 Internal reuse

The admin handlers do **not** re-implement S3 logic. They construct synthetic `Request` objects (or call shared inner functions extracted from the S3 handlers) so behavior stays consistent. Example: `PUT /_admin/buckets/foo/objects/bar/baz.txt` ultimately runs the same code path as `PUT /foo/bar/baz.txt`, with cookie auth in front of it instead of Sig V4.

`src/admin/shared.ts` exposes thin bridges with concrete shapes (final TS types are defined next to the existing handlers during implementation):

```ts
export type BucketSummary = { name: string; createdAt: string };
export type ObjectSummary = { key: string; size: number; lastModified: string; etag: string };
export type JsonListing   = {
  prefix: string;
  delimiter: string;
  objects: ObjectSummary[];
  commonPrefixes: string[];
  nextToken: string | null;
};

export async function adminListBuckets(ctx: AppContext, W: number): Promise<BucketSummary[]>;
export async function adminCreateBucket(ctx: AppContext, W: number, name: string): Promise<void>;
export async function adminDeleteBucket(ctx: AppContext, W: number, name: string): Promise<void>;
export async function adminListObjects(
  ctx: AppContext, W: number, bucket: string,
  q: { prefix?: string; delimiter?: string; token?: string; max?: number },
): Promise<JsonListing>;
export async function adminPutObject(
  ctx: AppContext, W: number, bucket: string, key: string,
  body: ReadableStream<Uint8Array>, headers: Headers,
): Promise<{ etag: string; size: number }>;
export async function adminGetObject(
  ctx: AppContext, W: number, bucket: string, key: string, range?: string,
): Promise<Response>;
export async function adminDeleteObject(ctx: AppContext, W: number, bucket: string, key: string): Promise<void>;
export async function adminBatchDeleteObjects(
  ctx: AppContext, W: number, bucket: string, keys: string[],
): Promise<{ deleted: string[]; errors: { key: string; code: string; message: string }[] }>;
```

Where the existing S3 handler is small, the bridge calls it directly. Where it's tightly coupled to XML output (e.g. `handleListObjects`), the listing/diff logic is factored into a pure function (returning the `JsonListing` shape) and the existing XML handler is refactored to wrap that helper. Both paths share one source of truth.

## 5. Admin API surface (`/_admin/*`)

JSON in/out. All responses set `Cache-Control: no-store`. No CORS headers (same-origin only).

### 5.1 Public (no cookie required)

| Method | Path | Description |
|---|---|---|
| `GET`  | `/_admin/health`  | `{ ok: true, version: string, hasPassword: boolean }`. No secrets. Used by SPA bootstrap to decide between "setup needed" and `/login`. |
| `POST` | `/_admin/login`   | Body `{ password }`. On success → `Set-Cookie: drime_admin=<signed>` (HttpOnly, SameSite=Strict, Secure when TLS, `Path=/_admin/`, 12h TTL) and `200 { authenticated: true }`. On wrong password → `401 { error: { code: "Unauthorized" } }`. Per-IP token bucket: 5 attempts / 5 min sliding → `429 RateLimited` with `Retry-After`. |
| `POST` | `/_admin/logout`  | Clears cookie. Idempotent → always `204`. |
| `GET`  | `/_admin/session` | `{ authenticated: boolean, expiresAt: string \| null }`. |

### 5.2 Protected (require valid `drime_admin` cookie)

| Method | Path | Description |
|---|---|---|
| `GET`  | `/_admin/status` | Onboarding status: `{ env: { drimeApiKeySet, drimeApiBaseUrl, s3KeysSet, region }, drime: { reachable, latencyMs, error?: string }, workspace: { name, id?: number, exists } }`. Drives the onboarding stepper. Calls `GET /me/workspaces` once and reports latency. |
| `POST` | `/_admin/init` | Calls existing `runInit()`. Idempotent. Returns `{ workspaceId }`. |
| `GET`  | `/_admin/buckets` | `{ buckets: [{ name, createdAt }], count }`. |
| `POST` | `/_admin/buckets` | Body `{ name }`. Validates with existing `isValidBucketName`. `409 BucketAlreadyExists` if exists. |
| `DELETE` | `/_admin/buckets/:bucket` | `409 BucketNotEmpty` if non-empty (matches S3). |
| `GET`  | `/_admin/buckets/:bucket/objects?prefix=&delimiter=/&token=&max=100` | `{ prefix, delimiter, objects: [{ key, size, lastModified, etag }], commonPrefixes: string[], nextToken: string \| null }`. |
| `PUT`  | `/_admin/buckets/:bucket/objects/*key` | Body is the file stream. Headers: `Content-Type`, `Content-Length`. Returns `{ etag, size }`. |
| `GET`  | `/_admin/buckets/:bucket/objects/*key` | Streams file to client. Honors `Range`. |
| `DELETE` | `/_admin/buckets/:bucket/objects/*key` | Single-object delete. `204` on success. |
| `POST` | `/_admin/buckets/:bucket/objects:batchDelete` | Body `{ keys: string[] }`. Returns `{ deleted: string[], errors: [{ key, code, message }] }`. |

### 5.3 Error envelope

```json
{ "error": { "code": "NoSuchBucket", "message": "...", "details": { ... } } }
```

Codes mirror S3 where applicable (`NoSuchBucket`, `BucketAlreadyExists`, `BucketNotEmpty`, `InvalidBucketName`) plus admin-only codes (`Unauthorized`, `WorkspaceUnavailable`, `RateLimited`, `AdminDisabled`).

## 6. Frontend structure

### 6.1 Stack

| Dep | Why |
|---|---|
| React 19 + Vite 6 + TS | shadcn/ui's blessed runtime; Vite's HMR is unmatched. |
| Tailwind v4 | shadcn-supported; design tokens align with the CSS-vars era. |
| shadcn/ui | Component library the user requested. Generated into `components/ui/` (not a runtime dep). |
| TanStack Query 5 | Caches `/_admin/status`, `/_admin/buckets`, etc.; optimistic updates for create/delete/upload. |
| React Router 6 | Tiny (~9 KB), data-router APIs let us gate routes on session/onboarding. |
| zod | Used by `api.ts` (response parsing) and `react-hook-form`. |
| sonner | shadcn's toaster. Upload completes / errors / bucket actions. |
| react-hook-form + `@hookform/resolvers/zod` | Login + create-bucket forms. |
| next-themes | Dark/light token plumbing (works with React 19; light toggle deferred to v1.1, tokens land in v1). |

**Bundle target**: initial JS < 180 KB gzipped. Login screen ships < 80 KB via route-level `lazy()` splits.

### 6.2 Routing & gating

`<RootGate>` runs on mount and decides which top-level route to render based on three queries:

```
GET /_admin/health          → has password set?
GET /_admin/session         → already authenticated?
GET /_admin/status          → onboarding complete?
```

Decision flow:

```
hasPassword === false   → /setup (instructions to set WEB_UI_PASSWORD)
authenticated === false → /login
status incomplete       → /onboarding
otherwise               → requested route (default /dashboard)
```

After login, the SPA invalidates the auth queries and re-decides.

### 6.3 Pages

- **`/login`** — single password field, react-hook-form + zod. Disables on submit; renders sonner toast on 401 / 429.
- **`/setup`** — shown only when `hasPassword === false`. Static instructions: "Set `WEB_UI_PASSWORD=…` in your environment (docker-compose example shown). Restart the gateway."
- **`/onboarding`** — vertical stepper (locked-in choice §3.7). Three steps:
  1. **Environment** — auto-pass; lists which envs are set/missing (no values shown).
  2. **Drime API** — auto-pass once `/status` returns `drime.reachable: true`. Shows latency.
  3. **Workspace** — if `workspace.exists === false`, shows the "Initialize workspace" CTA → `POST /_admin/init`. On success, advances and redirects to `/dashboard`.
  Step is "locked" until the previous step passes.
- **`/dashboard`** — Hero + Bucket Grid (locked-in choice §3.8). Hero text reads `"<count> buckets"` with status subtitle `"workspace <name> · Drime API healthy · <ms>"`. Below: bucket cards (icon, name, createdAt) + a `+ New bucket` CTA. Reserved slot in each card for a future size sparkline (v1.1).
- **`/buckets`** — full DataTable (name, created, actions: Open/Delete). Same `+ New bucket` dialog. Useful when count grows beyond what fits on the dashboard.
- **`/buckets/:bucket`** — Drop-anywhere bucket detail (locked-in choice §3.9):
  - Breadcrumbs: `Buckets / <bucket> / <prefix...>`.
  - Toolbar: Refresh, `+ Upload` (opens file picker), bulk Delete (visible when selection > 0).
  - DataTable columns: `[checkbox] Name | Size | Last modified | ⋯`. Folders sort first.
  - Drag-anywhere drop overlay, only visible during a drag. Reads dropped folder structure via `webkitGetAsEntry()` so dragging a directory uploads its tree (keys preserve relative paths).
  - Slide-in upload queue (top-right floating card) with per-file progress. Implementation: `XMLHttpRequest` is the v1 transport because `xhr.upload.onprogress` works in every browser. Concurrency: 3 in-flight uploads at a time, queued FIFO. Failures stay in the queue with a Retry button; success entries auto-dismiss after 4 s.
  - Pagination via continuation token (Next/Prev).
- **`/not-found`** — generic 404 inside the shell.

### 6.4 Components reused from shadcn

`button`, `input`, `label`, `card`, `dialog`, `sheet`, `dropdown-menu`, `table`, `breadcrumb`, `badge`, `skeleton`, `alert`, `tooltip`, `progress`, `separator`, `sonner`. Generated via `bunx shadcn@latest add` into `web/src/components/ui/`.

### 6.5 Theming

shadcn "new-york" style. Dark default. Brand accent: a calm teal-cyan that complements the Drime wordmark. CSS-vars driven so a future light toggle is a one-line flip.

### 6.6 Accessibility

- Radix-based shadcn primitives → keyboard nav, focus rings, aria attributes out of the box.
- Skip-to-content link in the shell.
- Logical heading order: page `<h1>` once, sections `<h2>`.
- DataTable rows are keyboard-navigable; ⋯ menu opens with Enter/Space; multi-select supports Shift+Click ranges.

## 7. Onboarding flow

```
[User opens http://localhost:8081/]
  → Server: Accept: text/html, no AWS auth → 302 /_ui/
  → SPA bootstrap:
      GET /_admin/health   → hasPassword ? continue : /setup
      GET /_admin/session  → authenticated ? continue : /login
      GET /_admin/status   → all green ? /dashboard : /onboarding
  → Onboarding wizard:
      Step 1 Environment   → auto-pass (or red badges if missing)
      Step 2 Drime API     → auto-pass when /status reports reachable
      Step 3 Workspace     → "Initialize" button → POST /_admin/init
  → /dashboard
```

The Initialize step is the only mutating action. All other steps are diagnostic.

## 8. Build, dev, docker

### 8.1 Dev

Two terminals (both fast):

```bash
bun run dev                          # gateway, --hot, port 8081
bun run --cwd web dev                # Vite dev server, port 5173
                                      #   proxies /_admin → http://127.0.0.1:8081
                                      #   proxies /<bucket>/* → http://127.0.0.1:8081 (so AWS clients still work in dev)
```

The proxy means cookies stick (single-origin from the SPA's perspective). Open `http://localhost:5173` for UI dev; `http://localhost:8081` continues to be the production-shape gateway.

### 8.2 Production build

```bash
bun run web:build                    # web/dist/ (static SPA)
bun run build                        # bun build src/cli/main.ts --compile --outdir=dist
                                      # uses `import` of web/dist/* via Bun.embeddedFiles
```

`src/admin/ui-assets.ts` resolves requests in this order:
1. `Bun.embeddedFiles` (set when binary was compiled with assets).
2. `web/dist/` next to the script (for `bun run start` development workflows).
3. `404`.

Cache headers: hashed assets (`*.[hash].js`, `*.[hash].css`) get `Cache-Control: public, max-age=31536000, immutable`; `index.html` is `no-cache`.

### 8.3 Root `package.json` script additions

| Script | Action |
|---|---|
| `web:dev`   | `bun run --cwd web dev` |
| `web:build` | `bun run --cwd web build` |
| `web:lint`  | `bun run --cwd web lint` |
| `build`     | depends on `web:build`; then `bun build src/cli/main.ts --compile --outdir=dist --target=bun` |

### 8.4 Docker

Multi-stage build matching the WEB_UI_PASSWORD ops story:

```dockerfile
FROM oven/bun:1.2 AS web-build
WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build                  # → /app/web/dist

FROM oven/bun:1.2 AS server-build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ ./src/
COPY --from=web-build /app/web/dist ./web/dist
RUN bun build src/cli/main.ts --compile --outdir=dist --target=bun

FROM oven/bun:1.2-slim
COPY --from=server-build /app/dist/main /usr/local/bin/drime-s3
EXPOSE 8081
ENTRYPOINT ["drime-s3", "serve"]
```

`docker-compose.yml` (env contract):

```yaml
services:
  drime-s3:
    image: drime-s3:latest
    ports: ["8081:8081"]
    environment:
      DRIME_API_KEY: ${DRIME_API_KEY}
      WEB_UI_PASSWORD: ${WEB_UI_PASSWORD}
      WEB_UI_SESSION_SECRET: ${WEB_UI_SESSION_SECRET}   # optional, derived if unset
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
      DRIME_S3_HOST: 0.0.0.0
```

## 9. Security

- **`WEB_UI_PASSWORD`** required for the admin UI. If unset, all `/_admin/*` (except `GET /_admin/health`) return `503 { error: { code: "AdminDisabled" } }`. Server logs a one-time warning at startup. SPA renders the `/setup` screen.
- **Constant-time compare** with `crypto.timingSafeEqual`. If user input differs in length, still execute a dummy compare of equal-size buffers to avoid timing leak.
- **Session cookie**: `drime_admin=<base64url(payload).hmac>`, HttpOnly, SameSite=Strict, `Path=/_admin/`, `Secure` when the request was TLS, 12 h TTL. Payload `{iat, exp, v: 1}`.
- **Session secret**: read from `WEB_UI_SESSION_SECRET` (hex, ≥32 bytes). If unset → derive `HKDF-SHA256(WEB_UI_PASSWORD, salt="drime-s3-session-v1", info="cookie-hmac")`. Implicit rotation on password change is acceptable for a self-hosted single-tenant tool.
- **Rate limiting** on `POST /_admin/login`: in-memory token bucket per remote IP, 5 attempts per 5 minutes (sliding window). Returns `429 RateLimited` with `Retry-After`.
- **CSRF**: not needed — `/_admin/*` is same-origin and the cookie is `SameSite=Strict`. We additionally reject `/_admin/*` requests whose `Origin` header doesn't match the request `Host` (when `Origin` is present).
- **Mixing with S3 Sig V4**: the auth check at the front of `dispatch` runs *before* path routing. `/_admin/*` skips Sig V4 entirely (it's cookie-authed); the S3 path is unchanged. The two never cross.
- **No upload reflection**: streaming upload goes straight into the existing PUT object handler — the gateway never persists the bytes beyond passing them through.
- **Logging**: pino structured logs. Add a sub-logger `name: "admin"`. Never log the cookie, password, or full request bodies. Existing per-request `x-amz-request-id` is reused for admin requests as a generic `request-id`.
- **`--insecure` does NOT disable admin auth.** `--insecure` only affects S3 Sig V4 verification. The admin UI continues to require `WEB_UI_PASSWORD` regardless. Otherwise an operator running `--insecure` on a non-loopback bind would accidentally leave the UI open.

## 10. Testing strategy

### 10.1 Backend

Extends the existing mock-Drime test harness in `tests/fixtures/mock-drime/server.ts`. New files:

- `tests/admin/auth.test.ts` — login happy path, wrong password, missing `WEB_UI_PASSWORD`, cookie expiry, rate-limit triggers, constant-time compare regression guard.
- `tests/admin/dispatch.test.ts` — front-of-line dispatch: AWS-Sig-V4 request to `/` → ListBuckets XML; browser request to `/` → 302 to `/_ui/`; `/_ui/index.html` returns SPA shell; `/_ui/assets/...` returns hashed bundle; `/_admin/*` without cookie → 401; `/_admin/*` with bad Origin → 403.
- `tests/admin/status.test.ts` — env detection matrix, Drime reachability success/failure, workspace presence/absence shape.
- `tests/admin/init.test.ts` — workspace bootstrap idempotent against mock Drime.
- `tests/admin/buckets.test.ts` — CRUD, 409 on duplicate, 409 on non-empty delete (mirroring existing S3 tests but via JSON).
- `tests/admin/objects.test.ts` — upload (small + large stream), download (full + range), single delete, batch delete; verify the same DrimeClient calls are made as the S3 path.

### 10.2 Frontend

- **Component tests**: Vitest + Testing Library. Targets: table multi-select, sort, breadcrumb navigation, upload-queue state machine, login-form validation, onboarding stepper gating.
- **E2E**: Playwright spec runs against a real gateway started with `WEB_UI_PASSWORD=test`, mock Drime in the background. Scenarios:
  - `setup-then-onboard`: empty `WEB_UI_PASSWORD` → `/setup` → set → restart → onboarding wizard → Initialize Workspace → dashboard.
  - `bucket-crud`: dashboard → New bucket → opens detail page → upload file → download file → delete file → buckets page → Delete bucket.

### 10.3 Pre-existing AWS-CLI smoke

Existing AWS-CLI / multipart smoke scripts (`smoke:large:aws:selftest`) keep passing. They only touch `/<bucket>/*`, never `/_admin` or `/_ui`.

## 11. Observability

- pino sub-logger `name: "admin"` on every admin request (request id, route, status, latency, authenticated bool).
- `GET /_health` (loopback only, unchanged) gains a `webUi: { passwordSet, activeSessions }` block. Useful for docker healthchecks.
- No client-side telemetry. The SPA never phones home.

## 12. Open questions deferred to implementation plan

- Exact MIME-type detection for streamed downloads in `adminGetObject` (likely just forward what the existing GetObject handler returns).
- Whether the dropdown-menu row actions should include "Copy URL" (presigned, short-lived) — current take: yes, but only via existing presigned-URL verification path so we don't add a new code path.
- Maximum single-file upload size — proposed cap **5 GB** in v1 (matches AWS S3 single-PUT cap). Larger files should still go through `aws s3 cp` (multipart) in v1.
- Deciding whether `WEB_UI_PASSWORD` should also be settable via `[admin] password` in `~/.config/drime-s3/config.toml`. Proposal: **yes, env wins** (consistent with other config knobs).

## 13. Versioning of this design

- v1 (this doc) — everything above.
- v1.1 — bucket sizes (server-side recursive walk + cache + invalidation on writes), light-mode toggle, optional persistent multipart resume for large browser uploads.
- v2 — multi-user accounts, audit log, object preview, lifecycle/tagging editors.
