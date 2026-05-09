# drime-s3 Admin Frontend SPA + Docker Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the React admin SPA under `web/`, served from `/_ui/*` by the existing Bun gateway (`dispatchUiAssets` replaces the Plan A 404 stub), with TanStack Query–backed flows for login, onboarding, dashboard, bucket detail (list/upload/delete/bulk), and production packaging via `Bun.embeddedFiles` + multi-stage Docker.

**Architecture:** Vite builds static assets into `web/dist/`. At runtime, `src/admin/ui-assets.ts` resolves files from embedded blobs (compiled binary) or `web/dist/` on disk (`bun run start`). Dev uses Vite on port **5173** with `server.proxy` forwarding `/_admin/*` to `http://127.0.0.1:8081` so cookies stay same-origin with `Origin`/`Host` matching the Vite origin. SPA `basename` is `/_ui`.

**Tech Stack:** Vite 6, React 19, TypeScript, Tailwind v4, shadcn/ui (new-york), TanStack Query 5, React Router 6, react-hook-form, zod, `@hookform/resolvers/zod`, sonner, Vitest, Testing Library, Playwright (E2E only).

**Spec:** [`docs/superpowers/specs/2026-05-09-drime-s3-frontend-design.md`](../specs/2026-05-09-drime-s3-frontend-design.md). Plan B implements §6–8 (frontend), §8.2–8.4 (build/docker), and the UI-facing portions of §9–10. Backend `/_admin/*` is Plan A.

**Backend contract (locked):** All JSON unless noted; `Cache-Control: no-store`; cookie `drime_admin` HttpOnly, `Path=/_admin/`; include `Origin` header matching `Host` when calling `/_admin/*`. Endpoints: `GET /_admin/health`, `POST /_admin/login`, `POST /_admin/logout`, `GET /_admin/session`, `GET /_admin/status`, `POST /_admin/init`, `GET|POST /_admin/buckets`, `DELETE /_admin/buckets/:bucket`, object list/put/get/delete, `POST .../objects:batchDelete`.

**V1 non-goals (do not implement):** per-bucket sizes, multi-user, in-UI secrets editing, light theme toggle, i18n, object preview/thumbnails, browser multipart.resume.

---

## File Structure (target)

| File | Purpose |
|---|---|
| `web/package.json` | Frontend deps, scripts: `dev`, `build`, `test`, `lint`, `typecheck`. |
| `web/vite.config.ts` | `base: '/_ui/'`, proxy `/_admin` → gateway, React plugin, Tailwind v4 pipeline. |
| `web/tsconfig.json`, `web/tsconfig.app.json` | Strict TS for SPA. |
| `web/index.html` | Shell entry (Vite). |
| `web/components.json` | shadcn CLI config. |
| `web/src/main.tsx` | React root, providers. |
| `web/src/app.tsx` | Routes, lazy pages, gate ordering. |
| `web/src/lib/api.ts` | `adminFetch`, `AdminApiError`, JSON parse + zod, `credentials: 'include'`, Origin injection, 401 handling hook-in. |
| `web/src/lib/query-keys.ts` | Canonical TanStack Query keys. |
| `web/src/lib/format.ts` | Bytes, dates. |
| `web/src/hooks/use-session.ts` | Session query + mutations for login/logout side effects. |
| `web/src/hooks/use-health.ts` | Public health query (`hasPassword`). |
| `web/src/hooks/use-status.ts` | Protected status query for onboarding + subtitles. |
| `web/src/hooks/use-buckets.ts` | Buckets list + invalidation helpers. |
| `web/src/hooks/use-objects.ts` | Listing with prefix/token; mutations for delete/batch/upload helpers. |
| `web/src/components/layout/shell.tsx` | Sidebar + topbar dark shell. |
| `web/src/components/gates/require-auth.tsx` | Redirect unauthenticated users to `/login`. |
| `web/src/components/gates/onboarding-gate.tsx` | Redirect when `workspace.exists === false`. |
| `web/src/components/error-boundary.tsx` | Global fallback UI + sonner or inline error. |
| `web/src/pages/login.tsx` | Password form. |
| `web/src/pages/setup.tsx` | Static instructions when `hasPassword === false`. |
| `web/src/pages/onboarding.tsx` | Vertical stepper wizard. |
| `web/src/pages/dashboard.tsx` | Hero + bucket grid + dialogs. |
| `web/src/pages/bucket-detail.tsx` | Table, breadcrumbs, upload queue host. |
| `web/src/components/objects/upload-queue.tsx` | Slide-in panel + XHR progress. |
| `package.json` *(root)* | Add `web:dev`, `web:build`, `web:test`, etc.; chain `web:build` before `build`. |
| `src/admin/ui-assets.ts` *(modify)* | Serve `web/dist` / embedded files with correct MIME + cache headers. |
| `src/cli/main.ts` or compile script *(modify)* | `Bun.embeddedFiles` glob for `web/dist/**`. |
| `Dockerfile` *(create, repo root)* | Multi-stage: web build → server compile → slim runtime. |
| `tests/e2e/**` *(optional create)* | Playwright specs + config. |
| `.github/workflows/*` *(modify if present)* | Install web deps, run `web:lint`, `web:test`, `web:build`. |

## How to run things

- Gateway: `bun run dev` (port **8081**).
- SPA dev: `bun run web:dev` or `bun run --cwd web dev` (port **5173**).
- Web unit tests: `bun run --cwd web test` (Vitest).
- Web lint/typecheck: `bun run --cwd web lint` · `bun run --cwd web typecheck`.
- Production asset check: `bun run web:build` then open gateway `/_ui/` with compiled server.
- Full backend tests remain: `bun test` at repo root.

## Conventions used by this plan

- **Routes inside the SPA:** `/login`, `/setup`, `/onboarding`, `/dashboard`, `/buckets/:bucket` (and optional `*` catch-all → not-found). Use React Router `BrowserRouter` with `basename="/_ui"`.
- **Gate order (matches spec §6.2):** `hasPassword === false` → `/setup`; else `authenticated === false` → `/login`; else `workspace.exists === false` → `/onboarding`; else protected routes.
- **TanStack Query:** `staleTime` moderate for `status`; short for `session`; refetch on window focus optional (default OK).
- **Errors:** Parse `{ error: { code, message } }` into `AdminApiError`; map `401` to session invalidation + redirect login.
- **Commits:** `feat(web):` features, `chore(web):` scaffold/config, `fix(web):` bugfixes, `test(web):` tests only, `build(docker):` Dockerfile/embed wiring.

---

## Appendix — shared reference (read before Phase 1)

### A. TanStack Query keys

Use `web/src/lib/query-keys.ts` as the single source of truth. Suggested shape:

| Key constant | Query key tuple | Notes |
|---|---|---|
| `healthKey` | `['admin','health']` | Public; never cleared on logout. |
| `sessionKey` | `['admin','session']` | Cleared indirectly via cache reset on logout. |
| `statusKey` | `['admin','status']` | Requires auth; drives onboarding + subtitles. |
| `bucketsKey` | `['admin','buckets']` | List + count; invalidate after create/delete bucket. |
| `objectsKey(bucket)` | `['admin','objects', bucket, { prefix, delimiter }]` | Use **infinite** variant: append page index or encode token in meta — avoid putting unbounded tokens inside stable keys unless hashed. |

**Invalidation cheat-sheet:**

- After login: invalidate `sessionKey`, optionally `statusKey`.
- After logout: `queryClient.removeQueries({ queryKey: ['admin'] })` except optionally keep `healthKey`.
- After `init`: `statusKey` only.
- After bucket CRUD: `bucketsKey`.
- After object mutations: `objectsKey` for affected bucket + prefix.

### B. Zod response stubs (mirror Plan A JSON)

Implement these beside `schemas.ts` (exact field names must match backend):

```ts
import { z } from "zod";

export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  hasPassword: z.boolean(),
});

export const SessionSchema = z.object({
  authenticated: z.boolean(),
  expiresAt: z.string().nullable(),
});

export const StatusSchema = z.object({
  env: z.object({
    drimeApiKeySet: z.boolean(),
    drimeApiBaseUrl: z.string(),
    s3KeysSet: z.boolean(),
    region: z.string(),
  }),
  drime: z.object({
    reachable: z.boolean(),
    latencyMs: z.number().optional(),
    error: z.string().optional(),
  }),
  workspace: z.object({
    name: z.string(),
    id: z.number().optional(),
    exists: z.boolean(),
  }),
});

export const InitResponseSchema = z.object({ workspaceId: z.number() });

export const BucketsResponseSchema = z.object({
  buckets: z.array(
    z.object({
      name: z.string(),
      createdAt: z.string(),
    }),
  ),
  count: z.number(),
});

export const BucketCreatedSchema = z.object({ name: z.string() });

export const ListingSchema = z.object({
  prefix: z.string(),
  delimiter: z.string(),
  objects: z.array(
    z.object({
      key: z.string(),
      size: z.number(),
      lastModified: z.string(),
      etag: z.string(),
    }),
  ),
  commonPrefixes: z.array(z.string()),
  nextToken: z.string().nullable(),
});

export const PutObjectResponseSchema = z.object({
  etag: z.string(),
  size: z.number(),
});

export const BatchDeleteResponseSchema = z.object({
  deleted: z.array(z.string()),
  errors: z.array(
    z.object({
      key: z.string(),
      code: z.string(),
      message: z.string(),
    }),
  ),
});

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
```

### C. Route tree + gate ordering (`web/src/app.tsx`)

Suggested nesting (pseudo-JSX):

```tsx
<Routes>
  <Route path="/setup" element={<SetupPage />} />
  <Route path="/login" element={<LoginPage />} />
  <Route element={<RequireAuth />}>
    <Route element={<OnboardingGate />}>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/buckets/:bucket" element={<BucketDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Route>
  </Route>
</Routes>
```

**Critical ordering detail:** `/onboarding` must remain reachable while `workspace.exists === false`. `<OnboardingGate>` should redirect **to** `/onboarding` but **must not** trap the user in a loop when already on that route.

`/setup` and `/login` stay **outside** `<RequireAuth>`.

### D. `Origin` header vs dev proxies

Plan A rejects mismatched `Origin` when present. Implementation checklist:

- Production UI is served from same host/port as gateway → browser sends `Origin` equal to page origin → passes.
- Vite dev (`127.0.0.1:5173`) → `fetch('/_admin/...')` sends `Origin: http://127.0.0.1:5173`. Confirm backend allows this during development **or** document running Vite with `--host` / tunnel matching configured gateway expectations.
- Never manually set `Origin` from Node tests impersonating the browser incorrectly — integration tests should mimic real headers.

### E. URL encoding for object keys

Object keys appear in path segments after `/objects/`. Encode **per segment** when keys contain `/` — the admin API uses `/*key` splat. Build URLs by splitting key on `/`, mapping each segment with `encodeURIComponent`, rejoining with `/`.

### F. Bulk delete + selection semantics

- Selecting a **folder row** (`commonPrefix`) is ambiguous for batch delete (server expects full object keys). **v1 rule:** disable bulk delete unless every selected row is a leaf object key.
- Shift-click range selection is spec §6.6 nice-to-have — implement only if low cost with `@tanstack/react-table` row selection helpers.

### G. Upload queue concurrency + retries

- Concurrency **3**: maintain `{ active: number, queue: FileTask[] }`; start next when one settles.
- Retry on network error only (not on `401` — those should trigger global logout).
- Cap file size **5 GB** client-side (design §12) with `toast.error` before enqueueing.

### H. `dispatchUiAssets` implementation notes

- Normalize `pathname`: strip `/ _ui` prefix, map `/` → `index.html`.
- **MIME:** derive from extension; fallback `application/octet-stream`.
- **Security:** reject paths containing `..` after normalization.
- **SPA fallback:** only when `Accept` includes `text/html` and requested path is not a known asset — prevents returning HTML for missing `.js` chunks.

### I. Bun compile embedding verification

After `bun build --compile`, run:

```bash
strings ./dist/main | head   # sanity — may show embedded paths depending on platform
```

If embedded lookup fails silently, add temporary logging in `dispatchUiAssets` gated behind `DRIME_S3_DEBUG_UI_ASSETS=1`.

### J. Accessibility checklist (v1 minimum)

- Skip link visible on focus.
- Wizard steps expose `aria-current="step"` on active card.
- Table checkboxes have `aria-label` per row.
- Upload queue announces completion via `aria-live="polite"` region.

### K. CI workflow snippet (GitHub Actions pseudo-job)

```yaml
- uses: oven-sh/setup-bun@v2
- run: bun install --frozen-lockfile
- run: bun install --frozen-lockfile --cwd web
- run: bun run web:lint && bun run web:typecheck && bun run web:test && bun run web:build
- run: bun test && bun run typecheck && bun run lint
```

---

<!-- TASKS-START -->

## Phase 1 — Scaffold

### Task 1: Create `web/` Vite + React 19 + TypeScript + Tailwind v4 + shadcn init

Goal: Establish the `web/` package with a compiling dev server and dark-oriented Tailwind v4 + shadcn/ui baseline.

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/tsconfig.app.json`, `web/tsconfig.node.json`, `web/index.html`
- Create: `web/src/main.tsx`, `web/src/index.css` (Tailwind entry), `web/src/vite-env.d.ts`
- Create: `web/components.json` (shadcn)
- Test: (manual verify in Step 4)

- [ ] **Step 1: Scaffold package**

From repo root:

```bash
mkdir -p web && cd web
bun create vite . --template react-ts
```

Pin versions to **Vite 6**, **React 19**, **TypeScript** current stable. Add Tailwind v4 per [Tailwind Vite plugin docs](https://tailwindcss.com/docs/installation/using-vite): `@tailwindcss/vite`, `@import "tailwindcss"` in `src/index.css`.

- [ ] **Step 2: Initialize shadcn/ui**

```bash
cd web && bunx shadcn@latest init
```

Choose: TypeScript, **new-york**, CSS variables, aliases `@/components`, `@/lib`. This produces `components.json` and updates CSS variables for dark-first tokens.

- [ ] **Step 3: Set `base` for nested deploy**

In `vite.config.ts`, set:

```ts
export default defineConfig({
  base: "/_ui/",
  // plugins, etc.
});
```

- [ ] **Step 4: Run + verify**

```bash
bun run --cwd web dev
```

Open `http://127.0.0.1:5173/_ui/` (note trailing path — Vite respects `base`). Expect default Vite + React splash without errors in console.

- [ ] **Step 5: Path sanity**

Confirm `import.meta.env.BASE_URL === '/_ui/'` in a throwaway `console.log` during dev. Remove log before commit.

- [ ] **Step 6: `index.html` asset references**

Vite rewrites script/link tags — view page source in browser; ensure `/_ui/@vite/client` loads without 404.

- [ ] **Step 7: Commit**

```bash
git add web/
git commit -m "chore(web): scaffold Vite 6 React TS Tailwind v4 shadcn"
```

---

### Task 2: TanStack Query provider, sonner Toaster, React Router skeleton

Goal: Wrap the tree with `QueryClientProvider`, mount `<Toaster />`, and define route shells with `BrowserRouter` + `basename`.

**Files:**
- Modify: `web/package.json` (deps: `@tanstack/react-query`, `react-router-dom`, `sonner`)
- Modify: `web/src/main.tsx`
- Create: `web/src/app.tsx`
- Create: `web/src/pages/placeholder.tsx` (temporary page component)

- [ ] **Step 1: Install dependencies**

```bash
bun add --cwd web @tanstack/react-query react-router-dom sonner
```

- [ ] **Step 2: Wire providers**

`main.tsx` should create a `QueryClient` (with `defaultOptions.queries.retry` sensible for admin API — e.g. 1 retry for GETs only), wrap `<QueryClientProvider>`, `<BrowserRouter basename="/_ui">`, and render `<App />`.

Mount `<Toaster richColors theme="dark" />` next to the router (sonner).

- [ ] **Step 3: Router skeleton**

In `app.tsx`, define `Routes` / `Route` for: `/login`, `/setup`, `/onboarding`, `/dashboard`, `/buckets/:bucket`, `*` → simple Not Found text. Use `Outlet` only if introducing nested layouts in Task 4.

- [ ] **Step 4: Lazy routes (optional prep)**

```tsx
const LoginPage = lazy(() => import("./pages/login"));
```

Wrap `<Suspense fallback={<Skeleton />}>`. Full lazy wiring can wait until pages exist — stub `placeholder.tsx` initially.

- [ ] **Step 5: Query defaults**

```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status === 401) return false;
        return failureCount < 1;
      },
    },
  },
});
```

After Task 6 introduces `AdminApiError`, replace the cast with `instanceof AdminApiError`.

- [ ] **Step 6: Run + verify**

```bash
bun run --cwd web dev
```

Navigate manually to `http://127.0.0.1:5173/_ui/login` etc. Expect no router errors.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/bun.lock web/src/main.tsx web/src/app.tsx web/src/pages/placeholder.tsx
git commit -m "feat(web): add Query client sonner and React Router skeleton"
```

---

### Task 3: Vite dev proxy for `/_admin/*` (and optional S3 path)

Goal: Forward admin API calls from the Vite origin to the Bun gateway so session cookies and `Origin` checks behave during UI development.

**Files:**
- Modify: `web/vite.config.ts`

- [ ] **Step 1: Configure `server.proxy`**

Add proxy rules:

```ts
server: {
  proxy: {
    "/_admin": {
      target: "http://127.0.0.1:8081",
      changeOrigin: true,
    },
    // Optional (spec §8.1): expose S3 paths for aws cli against dev UI origin
    // "^/(?!_ui/|@vite|src/).*": { target: "http://127.0.0.1:8081", changeOrigin: true },
  },
},
```

Keep the optional broad S3 proxy **off by default** unless you need it; document enabling it in a comment. Core requirement: **`/_admin` → 8081**.

- [ ] **Step 2: Dev ergonomics**

Ensure `fetch('/_admin/health')` from the SPA (same origin 5173) hits the gateway. Vite injects correct Host for the browser; `Origin` will be `http://127.0.0.1:5173` — **Plan A must accept this** when gateway dev binds match, or test with matching Host header rules as implemented server-side.

- [ ] **Step 3: Run + verify**

Terminal A: `bun run dev` (gateway). Terminal B: `bun run web:dev`. From browser console on `5173`:

```js
fetch("/_admin/health").then((r) => r.json()).then(console.log)
```

Expect JSON with `ok`, `version`, `hasPassword` when backend is up.

- [ ] **Step 4: Cookie Path caveat**

Session cookie uses `Path=/_admin/`. Browsers still send it on `fetch('/_admin/session')` from origin `5173` — verify in DevTools Application tab after login (Task 8).

- [ ] **Step 5: WebSocket HMR**

Ensure proxy does **not** steal `/@vite` or `/_ui/@vite` paths — narrow proxy key to `/_admin` prefix only.

- [ ] **Step 6: Commit**

```bash
git add web/vite.config.ts
git commit -m "chore(web): proxy /_admin to gateway for local development"
```

---

### Task 4: Base layout — sidebar/topbar shell, dark theme, no light toggle

Goal: Establish the persistent chrome for authenticated pages: skip link, shell grid, branding, nav links (Dashboard, logout placeholder).

**Files:**
- Modify: `web/package.json` (add `next-themes` per design §6.1 for token plumbing — dark only in v1)
- Create: `web/src/components/layout/app-shell.tsx`
- Create: `web/src/components/layout/sidebar.tsx`, `web/src/components/layout/topbar.tsx`
- Modify: `web/src/app.tsx` (wrap protected routes with shell)

- [ ] **Step 1: Add shadcn primitives**

```bash
bunx shadcn@latest add button separator tooltip skeleton
```

- [ ] **Step 2: Theme provider**

Wrap authenticated subtree with `ThemeProvider` from `next-themes`, `forcedTheme="dark"`, `enableSystem={false}` so v1 ships dark-only without a toggle.

- [ ] **Step 3: Shell layout**

`AppShell` accepts `children`. Include:

- Left sidebar: logo/wordmark area, nav link to Dashboard.
- Topbar: page title slot (via outlet context or child routes passing title later).
- Main: `<main id="main-content">` for skip link target.

Use Tailwind spacing consistent with shadcn defaults.

- [ ] **Step 4: Skip link**

```tsx
<a href="#main-content" className="sr-only focus:not-sr-only ...">
  Skip to content
</a>
```

Use Tailwind `sr-only` pattern from shadcn docs.

- [ ] **Step 5: Responsive sidebar**

Collapses to icon rail below `md` — optional v1.1; v1 can ship fixed sidebar if faster.

- [ ] **Step 6: Run + verify**

Visually inspect dark background + readable text; tab through sidebar links — focus rings visible.

- [ ] **Step 7: Commit**

```bash
git add web/
git commit -m "feat(web): add dark app shell layout sidebar and topbar"
```

---

### Task 5: CI-friendly scripts — `build`, `lint`, `typecheck`

Goal: Ensure `web/` can be validated in isolation and from the root `package.json`.

**Files:**
- Modify: `web/package.json` scripts
- Modify: `package.json` (root) scripts
- Modify: `biome.json` or add `web/eslint.config` only if required — **prefer Biome at root** if already unified; otherwise ESLint in `web/` is acceptable per ecosystem norms for Vite

- [ ] **Step 1: Web scripts**

Add:

```json
{
  "scripts": {
    "build": "tsc -b && vite build",
    "lint": "biome check .",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run"
  }
}
```

(Adjust if using ESLint instead of Biome for `web/` — pick one and document.)

- [ ] **Step 2: Vitest scaffold**

```bash
bun add -d --cwd web vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

Minimal `vitest.config.ts` with `environment: 'jsdom'`, `@testing-library/jest-dom` setup file.

- [ ] **Step 3: Root orchestration**

Root `package.json`:

```json
"web:dev": "bun run --cwd web dev",
"web:build": "bun run --cwd web build",
"web:lint": "bun run --cwd web lint",
"web:typecheck": "bun run --cwd web typecheck",
"web:test": "bun run --cwd web test"
```

- [ ] **Step 4: Align Biome scope**

If root `biome.json` ignores `web/`, either remove ignore or add `web/biome.json` extending root config.

- [ ] **Step 5: `npm pack` dry check**

```bash
cd web && bun run build && ls dist/assets
```

Confirm hashed filenames appear.

- [ ] **Step 6: Run + verify**

```bash
bun run web:typecheck && bun run web:lint && bun run web:build
```

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/vitest.config.ts package.json
git commit -m "chore(web): add build lint typecheck and vitest scripts"
```

*(Include `biome.json` / `web/biome.json` in `git add` only if this task touched them.)*

---

## Phase 2 — Auth

### Task 6: `web/src/lib/api.ts` — typed `adminFetch` + `AdminApiError`

Goal: Centralize JSON `fetch` with `credentials: 'include'`, zod parsing hooks, and structured errors for all admin calls.

**Files:**
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/api.test.ts`
- Create: `web/src/test/setup.ts` (if not already)

- [ ] **Step 1: Write failing unit test**

Test that a mocked `fetch` returning `401` + JSON error body throws `AdminApiError` with `.code` populated.

```ts
// api.test.ts sketch
import { describe, expect, test, vi } from "vitest";
import { adminFetchJson, AdminApiError } from "./api";

describe("adminFetchJson", () => {
  test("throws AdminApiError on 401 with envelope", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "Unauthorized", message: "nope" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      adminFetchJson("/_admin/session", { method: "GET", schema: /* minimal zod */ }),
    ).rejects.toMatchObject({ code: "Unauthorized" });
  });
});
```

- [ ] **Step 2: Implement `adminFetch` / `adminFetchJson`**

- Always set `credentials: 'include'`.
- Add `Origin: window.location.origin` when `typeof window !== 'undefined'`.
- `Content-Type: application/json` for JSON bodies.
- Parse error envelope; throw `AdminApiError` extending `Error` with `status`, `code`, `message`.
- Success path: parse with caller-supplied `zod` schema.

Expose optional **`onUnauthorized`** callback registration for Task 21 (global redirect). Stub as no-op initially.

Skeleton:

```ts
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(opts: { status: number; code: string; message: string }) {
    super(opts.message);
    this.status = opts.status;
    this.code = opts.code;
  }
}

let onUnauthorized: () => void = () => {};
export function registerUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function adminFetchJson<T>(
  path: string,
  init: RequestInit & { schema: z.ZodType<T> },
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: new Headers({
      ...(init.headers as HeadersInit),
      Origin: typeof window !== "undefined" ? window.location.origin : "",
    }),
  });
  if (res.status === 401) onUnauthorized();
  if (!res.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(await res.json().catch(() => null));
    throw new AdminApiError({
      status: res.status,
      code: parsed.success ? parsed.data.error.code : "UnknownError",
      message: parsed.success ? parsed.data.error.message : await res.text(),
    });
  }
  const json = await res.json();
  return init.schema.parse(json);
}
```

- [ ] **Step 3: Non-JSON responses**

Document that `adminFetchJson` is **not** used for binary `GET object` — downloads use `window.open` / raw `fetch` without JSON parse.

- [ ] **Step 4: DELETE / logout bodies**

`DELETE` and `204` responses have empty bodies — use separate `adminFetchEmpty()` helper.

- [ ] **Step 5: Run + verify**

```bash
bun run --cwd web test web/src/lib/api.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/api.test.ts web/src/test/setup.ts
git commit -m "feat(web): add admin fetch wrapper and AdminApiError"
```

---

### Task 7: `useHealth`, `useSession`, `/setup` route, `<RequireAuth>` guard

Goal: Bootstrap queries for `GET /_admin/health` and `GET /_admin/session`; redirect unauthenticated users away from protected routes; render `/setup` when `hasPassword === false`.

**Files:**
- Create: `web/src/hooks/use-health.ts`
- Create: `web/src/hooks/use-session.ts`
- Create: `web/src/components/gates/require-auth.tsx`
- Create: `web/src/pages/setup.tsx`
- Modify: `web/src/app.tsx`
- Create: `web/src/lib/schemas.ts` (zod schemas for health + session responses)

- [ ] **Step 1: Zod schemas**

Define schemas matching Plan A responses:

```ts
// session: { authenticated: boolean, expiresAt: string | null }
// health: { ok: boolean, version: string, hasPassword: boolean }
```

- [ ] **Step 2: Hooks**

`useHealthQuery` — public, hits `/_admin/health`, enabled on mount.

`useSessionQuery` — hits `/_admin/session`; may return 503 when admin disabled — handle gracefully routing to `/setup`.

- [ ] **Step 3: `<RequireAuth>`**

If session says `authenticated === false`, `Navigate` to `/login` with `replace`, preserving `location.state.from` optional.

- [ ] **Step 4: Top-level gate in `App`**

Before protected routes: if health loaded and `hasPassword === false`, render `/setup` route exclusively (or redirect any path to `/setup`).

- [ ] **Step 5: Component test**

Vitest: when session query returns unauthenticated, `RequireAuth` children not rendered; redirect to login. Use `MemoryRouter` + mocked query client.

- [ ] **Step 6: Run + verify**

```bash
bun run --cwd web test
bun run web:dev
```

With gateway **without** `WEB_UI_PASSWORD`, expect SPA shows setup instructions.

- [ ] **Step 7: Commit**

```bash
git add web/src/hooks web/src/components/gates web/src/pages/setup.tsx web/src/app.tsx web/src/lib/schemas.ts
git commit -m "feat(web): add health and session hooks setup route and RequireAuth"
```

---

### Task 8: `<LoginScreen>` — react-hook-form + zod, login mutation, sonner errors

Goal: Password field posts to `POST /_admin/login`; surface 401 / 429 / 503 via sonner; on success invalidate session and navigate.

**Files:**
- Create: `web/src/pages/login.tsx`
- Modify: `web/package.json` (`react-hook-form`, `zod`, `@hookform/resolvers`)
- Add shadcn: `input`, `label`, `card`, `form` (if generator supports), `alert`
- Create: `web/src/pages/login.test.tsx`

- [ ] **Step 1: Form schema**

```ts
const loginSchema = z.object({ password: z.string().min(1, "Required") });
```

- [ ] **Step 2: Mutation**

Use `useMutation` calling `adminFetchJson` for `/_admin/login`. On `200`: `queryClient.invalidateQueries({ queryKey: ['admin','session'] })`, then `navigate('/dashboard')`. The onboarding gate (Task 10) redirects to `/onboarding` when `workspace.exists === false`.

- [ ] **Step 3: Error mapping**

`401` → toast "Invalid password"; `429` → toast with retry hint; `503 AdminDisabled` → toast + link to setup.

```bash
bunx shadcn@latest add sonner
```

(Already mounted globally in Task 2 — ensure imports align.)

- [ ] **Step 4: Test**

Mock `adminFetch` / fetch: successful login triggers invalidate (spy on `queryClient.invalidateQueries`).

- [ ] **Step 5: Run + verify**

Manual: wrong password shows toast; correct password lands in app shell.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/bun.lock web/src/pages/login.tsx web/src/pages/login.test.tsx
git commit -m "feat(web): add login form with validation and sonner errors"
```

---

### Task 9: Logout button — `POST /_admin/logout`, clear cache, redirect

Goal: Idempotent logout that clears TanStack cache entries for admin data and returns operator to `/login`.

**Files:**
- Modify: `web/src/components/layout/sidebar.tsx` or `topbar.tsx`
- Modify: `web/src/hooks/use-session.ts` (optional `useLogoutMutation`)
- Create: `web/src/hooks/use-logout.ts`

- [ ] **Step 1: Mutation**

`POST /_admin/logout` with empty body; expect `204`.

On settle (even error — still client-reset): `queryClient.clear()` **or** targeted removes for `['session','status','buckets']` keys; then hard `navigate('/login')`.

- [ ] **Step 2: UI**

shadcn `Button` variant `ghost` in sidebar footer: "Log out".

- [ ] **Step 3: Run + verify**

After logout, `GET /_admin/session` from another tab should show logged out; UI shows login.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/layout web/src/hooks/use-logout.ts web/src/hooks/use-session.ts
git commit -m "feat(web): add logout control and query cache reset"
```

---

## Phase 3 — Onboarding

### Task 10: `useStatus()` + `<OnboardingGate>` — redirect when `workspace.exists === false`

Goal: Fetch `GET /_admin/status` for authenticated users and force `/onboarding` until workspace exists.

**Files:**
- Create: `web/src/hooks/use-status.ts`
- Create: `web/src/components/gates/onboarding-gate.tsx`
- Modify: `web/src/lib/schemas.ts`
- Modify: `web/src/app.tsx`

- [ ] **Step 1: Schema**

Match backend shape: `env`, `drime`, `workspace: { name, id?, exists }`.

- [ ] **Step 2: Hook**

`useStatusQuery` with key `['status']`, enabled only when `session.authenticated === true`.

- [ ] **Step 3: Gate component**

If status loaded and `workspace.exists === false` and path not `/onboarding`, redirect to `/onboarding`.

Allow `/login`, `/setup` to bypass.

- [ ] **Step 4: Test**

Mock query data with `exists: false` → expect redirect.

- [ ] **Step 5: Run + verify**

```bash
bun run --cwd web test
```

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/use-status.ts web/src/components/gates/onboarding-gate.tsx web/src/lib/schemas.ts web/src/app.tsx
git commit -m "feat(web): add status hook and onboarding redirect gate"
```

---

### Task 11: `<OnboardingWizard>` — vertical stepper, env + drime + workspace steps

Goal: Three-step vertical stepper using shadcn patterns (`Stepper` custom or `Card` stack); read-only diagnostics; "Initialize Workspace" calls `POST /_admin/init`.

**Files:**
- Create: `web/src/pages/onboarding.tsx`
- Create: `web/src/components/onboarding/wizard.tsx`
- Add shadcn: `badge`, `alert`, `progress`, `separator`, `card`
- Create: `web/src/pages/onboarding.test.tsx`

- [ ] **Step 1: Stepper UX**

Steps:

1. **Environment** — show booleans from `status.env` as badges (no secret values).
2. **Drime API** — show `reachable`, `latencyMs`, error string if any. Poll `refetchInterval` every few seconds until reachable **or** manual "Retry" button.
3. **Workspace** — if `exists`, show success; else CTA button `Initialize Workspace` → mutation `POST /_admin/init`.

Disable step 2 until step 1 "acknowledged" (auto), step 3 until drime reachable (spec: locked until previous passes).

- [ ] **Step 2: Init mutation**

On success: toast success; `invalidateQueries(['status'])`.

- [ ] **Step 3: Tests**

Stepper renders three headings; init button calls fetch mock.

- [ ] **Step 4: Run + verify**

Manual against mock Drime: workspace creation transitions step 3 to green.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/onboarding.tsx web/src/components/onboarding web/src/pages/onboarding.test.tsx
git commit -m "feat(web): add vertical onboarding wizard with init workspace"
```

---

### Task 12: Post-init navigation to `/dashboard`

Goal: After successful init (or when workspace already exists), land operator on the dashboard without manual URL entry.

**Files:**
- Modify: `web/src/pages/onboarding.tsx`
- Modify: `web/src/app.tsx` (default route)

- [ ] **Step 1: `useEffect` redirect**

When `status.workspace.exists` flips to `true`, `navigate('/dashboard', { replace: true })`.

- [ ] **Step 2: Default child route**

`/` under `/_ui` should redirect to `/dashboard` for authenticated + onboarded users.

Use `<Navigate to="/dashboard" replace />` route at `index`.

- [ ] **Step 3: Run + verify**

Complete wizard → URL becomes `/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/onboarding.tsx web/src/app.tsx
git commit -m "feat(web): navigate to dashboard after workspace ready"
```

---

## Phase 4 — Dashboard

### Task 13: `<Dashboard>` — hero bucket count + clickable bucket grid + empty state

Goal: `GET /_admin/buckets`; hero shows `count`; grid of shadcn `Card` tiles linking to `/buckets/:name`; empty state CTA.

**Files:**
- Create: `web/src/pages/dashboard.tsx`
- Create: `web/src/hooks/use-buckets.ts`
- Add shadcn: `card`, `badge`
- Create: `web/src/pages/dashboard.test.tsx`

- [ ] **Step 1: Hook**

`useBucketsQuery` — key `['buckets']`, parse `{ buckets, count }`.

- [ ] **Step 2: Layout**

Hero `<h1>`: `"{count} buckets"`; subtitle pulls drime health + workspace name from `useStatusQuery` (quiet typography per spec).

Grid: responsive `grid-cols-*`; each card shows bucket name + `createdAt` formatted via `lib/format.ts`.

- [ ] **Step 3: Empty state**

If `count === 0`, show illustration placeholder + button opening create dialog (Task 14).

- [ ] **Step 4: Tests**

Render with mocked buckets → cards have correct links.

- [ ] **Step 5: Run + verify**

```bash
bun run web:dev
```

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/dashboard.tsx web/src/hooks/use-buckets.ts web/src/lib/format.ts web/src/pages/dashboard.test.tsx
git commit -m "feat(web): add dashboard hero and bucket grid"
```

---

### Task 14: Create-bucket dialog — shadcn `Dialog`, react-hook-form + zod

Goal: Validate bucket name client-side; `POST /_admin/buckets`; handle `409 BucketAlreadyExists` + `400 InvalidBucketName` via toast; optimistic or invalidate list.

**Files:**
- Create: `web/src/components/buckets/create-bucket-dialog.tsx`
- Modify: `web/src/pages/dashboard.tsx`
- Add shadcn: `dialog`
- Create: `web/src/components/buckets/create-bucket-dialog.test.tsx`

- [ ] **Step 1: Form schema**

Align rules mentally with gateway `isValidBucketName` (DNS-like constraints) — mirror regex documented in backend tests or duplicate minimally with zod `.regex(...)`.

- [ ] **Step 2: Mutation**

On success: toast + invalidate `['buckets']`; optionally `navigate(/buckets/${name})`.

- [ ] **Step 3: Tests**

Submit invalid name → inline error; mock 409 → toast (spy).

- [ ] **Step 4: Run + verify**

Create bucket appears on dashboard without full reload.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/buckets/create-bucket-dialog.tsx web/src/pages/dashboard.tsx web/src/components/buckets/create-bucket-dialog.test.tsx
git commit -m "feat(web): add create bucket dialog with validation"
```

---

## Phase 5 — Bucket detail

### Task 15: `<BucketDetail>` route — breadcrumbs + shadcn DataTable shell

Goal: Implement `/buckets/:bucket` with breadcrumb prefix navigation and table scaffolding.

**Files:**
- Create: `web/src/pages/bucket-detail.tsx`
- Create: `web/src/components/objects/object-table.tsx`
- Create: `web/src/components/objects/breadcrumbs.tsx`
- Add shadcn: `breadcrumb`, `table`, `dropdown-menu`, `checkbox`, `skeleton`
- Modify: `web/src/app.tsx`

- [ ] **Step 1: Breadcrumbs**

Segments from `prefix` split on `/`; clicking segment truncates `prefix` query state.

- [ ] **Step 2: DataTable**

Use `@tanstack/react-table` **if** desired for column APIs; otherwise plain `<Table>` with manual header row — pick one and stay consistent. Plan assumes **shadcn Table + tanstack table** optional; minimum is sortable rows with folder rows first.

- [ ] **Step 3: Route param**

Read `:bucket` from `useParams`; validate existence lazily via listing error `NoSuchBucket` → not-found page.

- [ ] **Step 4: Run + verify**

Navigate from dashboard card → empty bucket renders table headers + empty state.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/bucket-detail.tsx web/src/components/objects web/src/app.tsx
git commit -m "feat(web): add bucket detail breadcrumbs and object table shell"
```

---

### Task 16: Object listing query — `prefix`, `delimiter=/`, `nextToken` pagination

Goal: Wire `GET /_admin/buckets/:bucket/objects` with query params; merge pages or provide Next/Prev.

**Files:**
- Create: `web/src/hooks/use-objects.ts`
- Modify: `web/src/components/objects/object-table.tsx`
- Modify: `web/src/lib/schemas.ts`

- [ ] **Step 1: Query function**

Use `delimiter=/` for folder-like `commonPrefixes`. Track `prefix` state in page component, pass to hook.

Pagination: keep a stack of tokens for "Prev" or flatten `useInfiniteQuery` — choose **`useInfiniteQuery`** with `getNextPageParam` from `nextToken`.

- [ ] **Step 2: Render rows**

`commonPrefixes` → folder rows (navigate deeper). `objects` → file rows with size / lastModified / etag.

- [ ] **Step 3: Tests**

Mock two pages with nextToken → hook returns flattened list length correct.

- [ ] **Step 4: Run + verify**

Large listing navigates forward/back without losing prefix.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/use-objects.ts web/src/components/objects/object-table.tsx web/src/lib/schemas.ts
git commit -m "feat(web): implement object listing with delimiter pagination"
```

---

### Task 17: Multi-select rows + bulk delete via `objects:batchDelete`

Goal: Checkbox column selects rows; toolbar bulk delete calls `POST /_admin/buckets/:bucket/objects:batchDelete` with `{ keys: string[] }`; toast summary from `{ deleted, errors }`.

**Files:**
- Modify: `web/src/components/objects/object-table.tsx`
- Create: `web/src/components/objects/bulk-delete-toolbar.tsx`
- Create: `web/src/components/objects/object-table.test.tsx`

- [ ] **Step 1: Selection state**

Keep `Set<string>` of full object keys in page component or context.

- [ ] **Step 2: Mutation**

Filter only **file** rows (not common prefixes). POST body `keys`.

On success: clear selection; invalidate object queries.

Partial errors: list first few in toast description.

- [ ] **Step 3: Confirmation**

shadcn `AlertDialog` confirming count.

- [ ] **Step 4: Tests**

Select two keys → mutation payload matches.

- [ ] **Step 5: Run + verify**

Bulk delete removes rows after refetch.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/objects
git commit -m "feat(web): add multi select and batch delete for objects"
```

---

### Task 18: Drop-anywhere upload — slide-in queue, XHR PUT with progress

Goal: Global dragenter/dragleave counters on `BucketDetail` page; dropping files enqueues uploads; `XMLHttpRequest` sends `PUT /_admin/buckets/:b/objects/:key` with `upload.onprogress`; concurrency **3**; `Sheet` slide-in from right for queue.

**Files:**
- Modify: `web/src/pages/bucket-detail.tsx`
- Create: `web/src/components/objects/upload-queue.tsx`
- Create: `web/src/lib/upload-xhr.ts`
- Add shadcn: `sheet`, `progress`
- Create: `web/src/lib/upload-xhr.test.ts` (pure reducer / queue logic)

- [ ] **Step 1: Queue state machine**

Items: `queued | uploading | success | error`. Store progress 0–100. Success auto-removes after **4s** (`setTimeout`).

- [ ] **Step 2: XHR helper**

```ts
export function putObjectXHR(params: {
  url: string;
  file: File;
  onProgress: (pct: number) => void;
  signal?: AbortSignal;
}): Promise<void> { /* resolve/reject */ }
```

Include `credentials: 'include'` is **not** enough on XHR — use `xhr.withCredentials = true`. Set `Origin` header if browser allows on XHR (some browsers restrict — fallback to same-origin only).

- [ ] **Step 3: Path builder**

Keys relative to current `prefix`; normalize slashes; guard `../`.

- [ ] **Step 4: Folder drop (optional v1)**

If `DataTransferItem.webkitGetAsEntry` available, walk directory tree; **if too large for time budget**, document deferral — spec requests it: implement basic recursion with breadth limit and toast on skip.

- [ ] **Step 5: Toolbar upload**

`+ Upload` opens `<input type="file" multiple>` — shares queue pipeline.

- [ ] **Step 6: Tests**

Unit-test queue reducer; avoid full XHR in Vitest.

- [ ] **Step 7: Drag overlay UX**

Render semi-transparent full-screen overlay when `dragDepth > 0` (increment on `dragenter`, decrement on `dragleave`). Prevent default on `drop`.

- [ ] **Step 8: Integration concerns**

`PUT` expects `Content-Length` — XHR sets automatically from `Blob`/`File`. For very large files monitor memory — streaming from disk is browser-managed.

- [ ] **Step 9: Run + verify**

Drop 5 files → max 3 active; progress bars move; objects appear after refetch.

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/bucket-detail.tsx web/src/components/objects/upload-queue.tsx web/src/lib/upload-xhr.ts web/src/lib/upload-xhr.test.ts
git commit -m "feat(web): add xhr upload queue with drop anywhere support"
```

---

### Task 19: Single-object actions — download (new tab) + delete with confirm

Goal: Row ⋯ menu: Download opens `GET` URL in new tab; Delete confirms then `DELETE` single key.

**Files:**
- Modify: `web/src/components/objects/object-table.tsx`
- Add shadcn: `dropdown-menu` (if not yet)

- [ ] **Step 1: Download**

Because cookie is HttpOnly, **cannot** fetch from new tab without auth. Use same-origin navigation with **per-segment encoding** (Appendix E): build `/objects/` + key segments joined with `/`. Avoid naive `encodeURIComponent` on the full key — slashes must remain path separators.

Example helper: `const url = '/_admin/buckets/' + encodeURIComponent(bucket) + '/objects/' + key.split('/').map(encodeURIComponent).join('/')`.

- [ ] **Step 2: Delete**

Call `DELETE`; toast; invalidate listing.

- [ ] **Step 3: Run + verify**

Download retrieves bytes; delete removes row.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/objects/object-table.tsx
git commit -m "feat(web): add per object download and delete actions"
```

---

## Phase 6 — Polish

### Task 20: Delete bucket from dashboard — confirm + `409 BucketNotEmpty` toast

Goal: Card dropdown or danger button triggers `DELETE /_admin/buckets/:bucket`; surface `409` with sonner message.

**Files:**
- Create: `web/src/components/buckets/delete-bucket-dialog.tsx`
- Modify: `web/src/pages/dashboard.tsx`

- [ ] **Step 1: AlertDialog flow**

Require typing bucket name **optional** — keep simple confirm for v1.

- [ ] **Step 2: Mutation**

Invalidate `['buckets']` on 204.

- [ ] **Step 3: Run + verify**

Non-empty bucket shows server message.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/buckets/delete-bucket-dialog.tsx web/src/pages/dashboard.tsx
git commit -m "feat(web): add delete bucket flow with empty bucket guard"
```

---

### Task 21: Global error boundary + `401` redirect interceptor

Goal: Catch render errors; centralize session expiry handling by registering `onUnauthorized` from Task 6.

**Files:**
- Create: `web/src/components/error-boundary.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/lib/api.ts`
- Create: `web/src/components/error-boundary.test.tsx` (optional — snapshot fallback)

- [ ] **Step 1: Error boundary**

Class component or `react-error-boundary` lightweight dependency — **prefer native class** to avoid extra dep.

Shows Card with "Something went wrong" + reload button.

- [ ] **Step 2: `onUnauthorized`**

In `main.tsx` after router creation, register callback: `queryClient.removeQueries()`, `navigate('/login')` — needs access to router (`useNavigate` only inside Router — use `window.location.assign('/_ui/login')` **or** a tiny `RouterSubscription` component inside `BrowserRouter`).

- [ ] **Step 3: Run + verify**

Simulate 401 from any query → lands on login.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/error-boundary.tsx web/src/main.tsx web/src/lib/api.ts
git commit -m "fix(web): add error boundary and global 401 handling"
```

---

## Phase 7 — Build + Docker

### Task 22: Implement `dispatchUiAssets` — serve `web/dist/` (and replace 404 stub)

Goal: `GET /_ui/*` returns real files: `index.html` for SPA fallback, hashed assets with long cache, `index.html` short cache.

**Files:**
- Modify: `src/admin/ui-assets.ts`
- Modify: `tests/admin/dispatch.test.ts` or equivalent *(create if missing)* — update `/_ui/index.html` expectation from 404 → 200 when file exists

- [ ] **Step 1: Resolver algorithm**

Pseudo:

```txt
map path → diskPath under web/dist
if file exists → stream with MIME
if is SPA navigation (Accept text/html) → index.html
else 404
```

Use `Bun.file` / `file.exists()` patterns.

- [ ] **Step 2: Cache headers**

Per spec §8.2: hashed filenames → `Cache-Control: public, max-age=31536000, immutable`; `index.html` → `no-cache`.

- [ ] **Step 3: Test**

Integration test: temp dir with fake `index.html`, point impl or env — **or** build web once in CI and assert 200. Minimal: create fixture file in `web/dist/.gitkeep` test override.

- [ ] **Step 4: Run + verify**

```bash
bun run web:build
bun run dev
curl -i http://127.0.0.1:8081/_ui/index.html
curl -i http://127.0.0.1:8081/_ui/assets/index-XXXXX.js   # replace with real hashed name from dist
```

Second command should return `immutable` cache header once implemented.

- [ ] **Step 5: Align Plan A dispatch test**

Update test that expected `404` for `/_ui/index.html` to expect `200` **when** `web/dist/index.html` exists in CI (generate via `web:build` step before admin tests, or skip test when dist missing using `test.skipIf`).

- [ ] **Step 6: Commit**

```bash
git add src/admin/ui-assets.ts tests/admin/dispatch.test.ts
git commit -m "feat(admin): serve SPA static assets from web dist via dispatchUiAssets"
```

---

### Task 23: `bun build --compile` embeds `web/dist` via `Bun.embeddedFiles`

Goal: Production binary includes assets; `dispatchUiAssets` reads embedded first.

**Files:**
- Modify: `src/admin/ui-assets.ts` (embedded lookup)
- Modify: `package.json` root `build` script
- Document in comment or `scripts/build-release.sh`

- [ ] **Step 1: Embed pattern**

At compile time (Bun docs): pass `--compile` with embedded files glob:

```bash
bun build src/cli/main.ts --compile --outdir=dist --target=bun \
  --embed ./web/dist/*
```

Verify exact Bun version flag syntax for your pinned Bun — adjust to `*.js` / `**` as supported.

If `--embed` is unavailable, fall back to copying `web/dist/**` next to the binary in packaging scripts only — **preference** is single-file binary per spec.

Reference ([Bun embedded files](https://bun.sh/docs/bundler/executables)) — confirm against installed Bun:

```bash
bun build --help | rg -n embed
```

- [ ] **Step 2: Lookup order**

1. Embedded map  
2. `./web/dist` adjacent to running script (non-compiled)  
3. 404

Pseudo:

```ts
async function resolveUiAsset(pathname: string): Promise<Bun.File | null> {
  const embedded = tryEmbedded(pathname);
  if (embedded) return embedded;
  const disk = Bun.file(`${import.meta.dir}/../../web/dist${pathname}`);
  if (await disk.exists()) return disk;
  return null;
}
```

Adjust paths relative to compiled binary layout.

- [ ] **Step 3: Root `build` script**

Root `package.json`:

```json
"build": "bun run web:build && bun build src/cli/main.ts --compile --outdir=dist --target=bun --embed ./web/dist/**"
```

(Glob syntax subject to Bun version.)

- [ ] **Step 4: Non-compile dev path**

Keep existing `bun build src/cli/main.ts --outdir=dist --target=bun` without embed for developers iterating server-only — document under `build:dev` if needed.

- [ ] **Step 5: Run + verify**

```bash
bun run web:build && bun run build
./dist/main serve # binary name may vary
curl -i http://127.0.0.1:8081/_ui/
```

- [ ] **Step 6: Commit**

```bash
git add package.json src/admin/ui-assets.ts
git commit -m "build: embed web dist in compiled gateway binary"
```

---

### Task 24: Multi-stage Dockerfile — Node or Bun for web build, Bun compile for server

Goal: Reproducible image matching spec §8.4 with locked lockfiles.

**Files:**
- Create: `Dockerfile` (repo root)
- Create: `.dockerignore`
- Optionally modify: `docker-compose.yml` (if exists)

- [ ] **Step 1: Stages**

1. **`web-build`**: `FROM oven/bun:1.2-alpine` (or Debian slim), copy `web/package.json` + lock, `bun install --frozen-lockfile`, copy `web/`, `bun run build` → `/app/web/dist`.

2. **`server-build`**: copy root `package.json` + lock, install, copy `src/`, copy `--from=web-build /app/web/dist ./web/dist`, run `bun build ... --compile`.

3. **Runtime**: minimal image copying only the compiled binary to `/usr/local/bin/drime-s3`, `EXPOSE 8081`, `ENTRYPOINT ["drime-s3","serve"]`.

**Healthcheck example:**

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8081/_health || exit 1
```

Use `/_health` loopback semantics already enforced by gateway — adjust command if image lacks `wget` (install `curl` or use Bun fetch script).

- [ ] **Step 2: `.dockerignore`**

Exclude `node_modules`, `web/node_modules`, `.git`, large smoke payloads.

Full suggested list:

```
.git
**/node_modules
scripts/bin
*.zip
coverage
dist
web/dist   # rebuilt inside web-build stage — OK to exclude context upload
```

- [ ] **Step 3: Run + verify**

```bash
docker build -t drime-s3:plan-b .
docker images | head
```

- [ ] **Step 4: Image size sanity**

Record uncompressed size in PR description; flag if > 250 MB (investigate slim base / strip symbols).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build(docker): add multi stage image with embedded admin UI"
```

---

### Task 25: Final smoke — Docker run + curl-driven E2E (+ optional Playwright)

Goal: Prove login → init → bucket → upload → list → download → delete works through the real stack.

**Files:**
- Create: `tests/e2e/README.md` *(optional — user asked no extra markdown unless needed; skip README — put instructions in this task only)*
- Create: `tests/e2e/playwright.config.ts`, `tests/e2e/admin-smoke.spec.ts` *(optional but recommended)*
- Modify: root `package.json` — `e2e` script

- [ ] **Step 1: Container run**

```bash
docker run --rm -p 8081:8081 \
  -e WEB_UI_PASSWORD=testpass \
  -e DRIME_API_KEY=dummy \
  -e S3_ACCESS_KEY=a -e S3_SECRET_KEY=b \
  drime-s3:plan-b
```

(Adjust env to match real Drime mock networking — may require `docker compose` with mock Drime sidecar.)

- [ ] **Step 2: Curl flow**

```bash
curl -s http://127.0.0.1:8081/_admin/health
curl -s -c co -H 'Origin: http://127.0.0.1:8081' -H 'Content-Type: application/json' \
  -d '{"password":"testpass"}' http://127.0.0.1:8081/_admin/login
curl -s -b co -H 'Origin: http://127.0.0.1:8081' http://127.0.0.1:8081/_admin/status
# ... init, create bucket, put object via curl, get, delete as in Plan A Task 23
```

Include **`/_ui/`** fetch: `curl -I http://127.0.0.1:8081/_ui/` → `200` + `text/html`.

**Expanded bash sequence (happy path sketch):**

```bash
HOST=http://127.0.0.1:8081
ORIGIN="$HOST"

curl -fsS "$HOST/_admin/health" | jq -e '.hasPassword == true'

curl -fsS -c co -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -d '{"password":"testpass"}' "$HOST/_admin/login" | jq .

curl -fsS -b co -H "Origin: $ORIGIN" "$HOST/_admin/session" | jq .

curl -fsS -b co -H "Origin: $ORIGIN" "$HOST/_admin/status" | jq .

curl -fsS -b co -H "Origin: $ORIGIN" -X POST "$HOST/_admin/init" | jq .

curl -fsS -b co -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -d '{"name":"e2e-bucket"}' "$HOST/_admin/buckets" | jq .

echo 'hello-plan-b' | curl -fsS -b co -H "Origin: $ORIGIN" \
  -X PUT --data-binary @- "$HOST/_admin/buckets/e2e-bucket/objects/hello.txt" | jq .

curl -fsS -b co -H "Origin: $ORIGIN" \
  "$HOST/_admin/buckets/e2e-bucket/objects?delimiter=/&prefix=" | jq .

curl -fsS -b co -H "Origin: $ORIGIN" \
  "$HOST/_admin/buckets/e2e-bucket/objects/hello.txt" | grep -q hello-plan-b

curl -fsS -o /dev/null -w '%{http_code}' -b co -H "Origin: $ORIGIN" \
  -X DELETE "$HOST/_admin/buckets/e2e-bucket/objects/hello.txt" | grep -q 204

curl -fsS -o /dev/null -w '%{http_code}' -b co -H "Origin: $ORIGIN" \
  -X DELETE "$HOST/_admin/buckets/e2e-bucket" | grep -q 204
```

Adjust bucket names if collisions occur; assert HTTP codes via `-w` where bodies empty.

- [ ] **Step 3: Optional Playwright**

`npx playwright install` in CI; start gateway + mock Drime fixture; visit `http://127.0.0.1:8081/_ui/login`, fill password, walk onboarding, upload file via UI input, assert row appears.

Reserve Playwright for **one** happy-path; keep Vitest as primary fast suite.

**Playwright skeleton:**

```ts
import { test, expect } from "@playwright/test";

test("admin smoke", async ({ page }) => {
  await page.goto("/_ui/login");
  await page.getByLabel(/password/i).fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/dashboard|onboarding/);
});
```

Use `baseURL: http://127.0.0.1:8081` in config.

- [ ] **Step 4: Repo verification**

```bash
bun test && bun run web:test && bun run web:lint && bun run web:typecheck && bun run web:build
```

- [ ] **Step 5: S3 regression**

```bash
bun run smoke:large:aws:selftest
```

Expect PASS per Plan A Task 23 note.

- [ ] **Step 6: Final commit**

Only if Playwright wired:

```bash
git add tests/e2e package.json bun.lock
git commit -m "test(e2e): add playwright smoke for admin UI"
```

Otherwise **no commit** if verification only.

---

## Plan B Done

At this point the Bun gateway serves the production SPA from `/_ui/*`, the React app fulfills login → onboarding → dashboard → bucket CRUD + object listing/upload/delete/bulk flows, and Docker ships a single portable binary image. Extend with `/buckets` table page, light theme, and bucket metrics in v1.1 per design §13.

<!-- TASKS-END -->
