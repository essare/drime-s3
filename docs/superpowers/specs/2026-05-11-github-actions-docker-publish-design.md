# drime-s3 — GitHub Actions Docker build and publish

**Date:** 2026-05-11  
**Status:** Approved (brainstorming complete; ready for implementation planning)  
**Author:** Brainstorming session output  
**Related:** Root [`Dockerfile`](../../../Dockerfile) (multi-stage Bun build + Alpine runtime).

---

## 1. Goal

Add a **GitHub Actions** workflow that:

1. **Builds the full project** the same way production does today: root `Dockerfile` (web SPA build, `scripts/build-release.ts`, compiled `drime-s3` binary + embedded static UI).
2. **Publishes one image** (single digest) to **Docker Hub** and **GitHub Container Registry (GHCR)** under fixed names.
3. **Runs automatically** on **`push` to `main`** and on **`push` of semver git tags** (`v*`).
4. Implements **hybrid semver (option C)**: **rolling** image tags from `main`; **manual** `v*` git tags for releases; **no** CI-created release tags.

---

## 2. Why this is worth doing

Operators and contributors get **reproducible images** tied to `main` and to **tagged releases**, without manual local `docker buildx` steps. Dual registry support avoids lock-in (Docker Hub for broad discoverability, GHCR for GitHub-native integration and `GITHUB_TOKEN` auth).

---

## 3. Non-goals (v1)

- **Google Container Registry (`gcr.io`)** or Artifact Registry.
- **Multi-arch images** beyond **linux/amd64** (arm64 can be a follow-up).
- **CI-created semver tags** or automated version bumps (no `semantic-release` / bot tags in v1).
- **Attestations / SBOM / provenance** on every push (can be enabled later).
- **Workflows on pull requests** that publish images (optional separate “CI only” workflow is out of scope unless added later).
- **Signing** images with Cosign (future).

---

## 4. Locked decisions

| # | Topic | Decision |
|---|--------|----------|
| 1 | **Docker Hub image** | `docker.io/essare/drime-s3` |
| 2 | **GHCR image** | `ghcr.io/essare/drime-s3` (lowercase owner per GHCR rules) |
| 3 | **Docker Hub auth** | Repository secrets `DOCKERHUB_USERNAME` (value `essare`) and `DOCKERHUB_TOKEN` (Docker Hub access token with push; not account password) |
| 4 | **GHCR auth** | `GITHUB_TOKEN` with job permissions `packages: write` |
| 5 | **Triggers** | `push` to branch `main`; `push` tags matching pattern `v*` |
| 6 | **Semver / tags model** | **Hybrid C:** `main` pushes publish rolling tags only; humans push `vX.Y.Z` (and optional prereleases like `v2.0.0-rc.1`) to publish release tags |
| 7 | **Rolling tags (from `main`)** | At minimum `main` and `sha-<short>` |
| 8 | **Release image tags (from git tag)** | Docker tags including **`vX.Y.Z`** and **`X.Y.Z`** (strip leading `v` for the second); **`latest`** only for **stable** semver (no prerelease per SemVer 2.0.0); prerelease git tags publish version tags but **do not** move **`latest`** |
| 9 | **Workflow layout** | **Single workflow file** under `.github/workflows/` (DRY; split later only if readability suffers) |
| 10 | **Build** | Repository root context; `docker/build-push-action` with Buildx; **linux/amd64**; GitHub Actions cache (`type=gha`) for BuildKit layers |
| 11 | **Quality gates before Docker** | `bun test`, `bun run typecheck`, `bun run lint` must pass (install deps per project norms: root `bun install`, and `web` as required by scripts) |
| 12 | **Concurrency** | `concurrency` group keyed by workflow + ref; `cancel-in-progress: true` for `main`; `cancel-in-progress: false` for tag refs |
| 13 | **Single digest** | One build, one push step targeting **both** image names so Hub and GHCR share the same digest |

---

## 5. Triggers and tag semantics (detail)

### 5.1 `push` to `main`

- Run quality job then image job.
- Push to both registries with tags **`main`** and **`sha-<7+ char git sha>`** (exact short length follows `docker/metadata-action` defaults unless overridden).

### 5.2 `push` tags matching `v*`

- Restrict workflow tag filter to avoid accidental runs on non-semver tags (e.g. `v*` glob at workflow `on.push.tags` level, plus a job-level guard if the repo ever adds other `v` prefixes).
- **Stable example:** git tag `v1.4.0` → image tags **`v1.4.0`**, **`1.4.0`**, **`latest`** on both registries.
- **Prerelease example:** git tag `v2.0.0-rc.1` → image tags **`v2.0.0-rc.1`**, **`2.0.0-rc.1`**; **`latest` is not updated**.

Implementation note: `docker/metadata-action` supports semver type with flavor rules; configure `latest` auto behavior to align with stable vs prerelease (or explicit `custom`/`type=raw` only if defaults are insufficient).

---

## 6. Jobs (recommended shape)

### 6.1 `quality`

- **Runner:** `ubuntu-latest`.
- **Steps (conceptual):** checkout; setup Bun (pin to Dockerfile’s Bun minor or use `oven-sh/setup-bun` with version read from a single source of truth if practical); `bun install --frozen-lockfile` at repo root; `bun install --frozen-lockfile` in `web/` if not fully hoisted; run `bun test`, `bun run typecheck`, `bun run lint` from root (root `package.json` already delegates `web:*` where needed).
- **Failure:** fail workflow; skip image job via `needs: [quality]`.

### 6.2 `docker-publish`

- **Runner:** `ubuntu-latest`.
- **Needs:** `quality`.
- **Permissions:** `contents: read`, `packages: write`.
- **Steps (conceptual):** checkout; Set up QEMU only if multi-arch is added later (omit in v1); Set up Docker Buildx; Log in to Docker Hub (`docker/login-action` with secrets); Log in to GHCR (`docker/login-action` with `registry: ghcr.io`, username = `github.actor` or `${{ github.repository_owner }}`, password = `GITHUB_TOKEN`); `docker/metadata-action` with `images: docker.io/essare/drime-s3` and `ghcr.io/essare/drime-s3` and tag rules per §5; `docker/build-push-action` with `push: true`, platforms `linux/amd64`, cache from/to GHA.

---

## 7. Repository configuration (manual)

| Item | Action |
|------|--------|
| Docker Hub | Create access token; add secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` |
| GHCR | First push may create package; set visibility if the repo is public and package should be public |
| `main` branch | Workflow assumes default release branch is named **`main`**; rename in workflow if the repo uses another default later |

---

## 8. Testing the design

- **Merge to `main`:** confirm workflow runs, quality passes, image appears with `main` and `sha-*` on both registries.
- **Push `v0.1.0` tag:** confirm `v0.1.0`, `0.1.0`, `latest` on both registries.
- **Push `v0.2.0-rc.1`:** confirm rc tags exist; **`latest`** still points at last **stable** tag behavior per metadata rules.
- **Failing test:** confirm image job is skipped / workflow fails before push.

---

## 9. Failure modes and recovery

| Failure | Behavior |
|---------|----------|
| Lint / test / typecheck failure | Workflow fails; no image push |
| Docker build failure | Workflow fails; no push |
| Push denied (auth / quota) | Workflow fails; fix secrets or registry quota; re-run workflow |
| Partial push | Single `build-push-action` invocation with both `images` minimizes split-brain digests; if a registry is down, retry after outage |

---

## 10. Implementation handoff

After this spec is reviewed, create an implementation plan (separate step) that adds:

- `.github/workflows/<name>.yml` implementing §6–§7.
- Optional `README` snippet listing published coordinates and required secrets (only if maintainers want it; not required by this spec).

No application code changes are required for the Docker image itself unless the workflow discovers a missing lockfile or install step; the Dockerfile remains the source of truth for the release artifact.
