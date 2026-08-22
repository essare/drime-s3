# Speed improvements (surgical hot-path) — Design

**Date:** 2026-08-22  
**Status:** Approved for planning  
**Baseline:** `docs/bench/baseline-2026-08-22.*` (`v1.5.4`)  
**Branch intent:** `feat/speed-improvements`

## Problem

S3 clients (AWS CLI, restic, Duplicati, etc.) talk to this **gateway**, which maps S3 to Drime. Live baseline shows client-visible throughput far below what large multipart transfers should achieve, and small objects are especially slow:

| Op (median) | Throughput / latency |
|-------------|----------------------|
| PUT 10 MiB | ~1.07 MiB/s |
| PUT 100 MiB | ~9.0 MiB/s |
| PUT 512 MiB | ~17.1 MiB/s |
| GET 10 MiB | ~1.35 MiB/s |
| GET 100 / 512 MiB | ~17.8 / ~26.2 MiB/s |
| HEAD 10 MiB | ~1.7 s (vs ~280 ms for larger) |

Root causes already identified in code (not speculative):

- Large PUT: internal multipart with hardcoded **part concurrency = 4**
- Small PUT: spool + single-shot `POST /uploads`, plus sequential parent-folder ensure
- GET/HEAD: optional **full-body buffer** to compute strong MD5 ETag for objects ≤64 MiB
- DeleteBucket: `aws s3 rb` / `delete-bucket` fails with an empty error even when the bucket lists empty

## Goals

- **Large PUT/GET** (100 MiB, 512 MiB): **>2×** median MiB/s vs baseline
- **Small PUT/GET** (10 MiB): **clearly faster** than baseline (stretch toward 2× if the path allows)
- Keep the **S3 API surface** clients use today (compatible status codes and header shapes)
- **ETag policy configurable**; **default = speed** (no full-object download just to mint MD5)
- **Fix DeleteBucket** so empty buckets delete cleanly via CLI
- Re-measure with the same harness; publish `docs/bench/optimized-<date>.*`

## Non-goals (this pass)

- Streaming PUT / eliminate spool (Approach B — follow-up if A misses the bar)
- Admin UI / dashboard changes
- Implementing `UploadPartCopy` (CLI server-side copy for large objects)
- Changing Drime’s upstream API contracts

## Approach

**Surgical hot-path wins (Approach A)** — tune and fix gateway hot paths; no protocol redesign.

Rejected for this pass:

- **B (streaming PUT):** higher upside, higher correctness risk (Content-Length, retries, Sig V4)
- **C (knobs only):** unlikely to clear >2× or fix small-PUT / DeleteBucket

## Design

### 1. Internal multipart (large PUT)

- Make part concurrency env-tunable (e.g. `DRIME_S3_MULTIPART_PART_CONCURRENCY`), default **raised** from 4 (target band **8–16**, finalize in implementation after a quick live sanity check).
- Optionally document / allow part-size override already present (`DRIME_S3_MULTIPART_PART_SIZE_BYTES`).
- Keep: spool → create → batch-sign → parallel part PUT → complete → create entry.
- Primary lever for **>2×** on 100/512 MiB PUT when clients use `aws s3 cp` (CLI multipart) or gateway-promoted multipart over threshold.

### 2. Small PUT

- Keep spool + `/uploads` for this pass.
- Reduce sequential latency in `ensureParentFolderForPut` where safe (parallelize independent segment work; preserve single-flight / list-cache semantics so races do not create duplicate folders).
- Avoid redundant post-upload work when metadata is already known.
- Success: clearly faster 10 MiB PUT vs baseline; 2× is a stretch, not a hard gate.

### 3. GET streaming + ETag policy

- Default GET: stream upstream body; **do not** buffer the body solely to compute a strong MD5 ETag.
- Default HEAD: use stored FileEntry metadata / existing weak ETag; **do not** full-download for MD5.
- Opt-in restore of today’s strong-ETag download behavior for strict clients (e.g. Duplicati):
  - Prefer a clear flag such as `DRIME_S3_STRONG_ETAG=1`, and/or keep interpreting `DRIME_S3_CONTENT_ETAG_BUFFER_BYTES` as enabling buffer-up-to-N when strong ETag mode is on.
  - Document in README / `.env.example`.

### 4. DeleteBucket

- Diagnose empty CLI error on empty buckets (response status/body vs stale `listFolder` children vs cache).
- Fix so `aws s3api delete-bucket` and `aws s3 rb` succeed on a truly empty bucket.
- Preserve `BucketNotEmpty` (409) when children exist.
- Enables clean bench teardown and normal operator cleanup.

### 5. Verification

- Same ladder and harness conventions as baseline (Sig V4, 3 runs, median).
- Write `docs/bench/optimized-<date>.json` + `.md`.
- Compare to `docs/bench/baseline-2026-08-22.*`.
- Unit/integration coverage for: ETag default vs opt-in; concurrency env parsing; DeleteBucket empty vs non-empty.
- Existing smokes must still pass (`smoke:real`, multipart selftests as applicable).

## Risks

| Risk | Mitigation |
|------|------------|
| Higher part concurrency hits Drime/R2 rate limits | Env knob; lower default if live checks show 429s |
| Weak/default ETag surprises strict clients | Document opt-in; README callout |
| Parallel folder ensure races | Keep list-cache single-flight; no duplicate create without check |
| DeleteBucket root cause is upstream | Surface clear S3 error; still improve gateway handling/caching |

## Rollout

- Defaults favor speed.
- No data migration.
- Residual empty `bench-*` folders from baseline removable once DeleteBucket works.

## Acceptance

| Path | Bar vs baseline |
|------|-----------------|
| PUT/GET 100 MiB & 512 MiB | **>2×** median MiB/s |
| PUT/GET 10 MiB | Clearly faster |
| HEAD (default policy) | No full-body download for ETag; 10 MiB HEAD should drop toward large-object HEAD latency |
| DeleteBucket | Empty bucket deletes successfully via AWS CLI |
| List / other ops | No intentional regressions |

## Follow-up (explicitly deferred)

- Streaming uploads without spool (Approach B)
- `UploadPartCopy` for large server-side copy
- Further small-PUT redesign if “clearly faster” is still insufficient after A
