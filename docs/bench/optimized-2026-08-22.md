# Optimized 2026-08-22

- Git: `v1.5.4-6-ga681edb` (`a681edbf9e49`)
- Endpoint: `http://127.0.0.1:8082`; Sig V4 ON
- Runs per operation: 3
- Default run used multipart concurrency 12 and bucket `bench-20260822`.
- Required retry used multipart concurrency 16 and isolated bucket `bench-20260822-c16`.
- JSON contains the concurrency-16 retry; default-run medians are retained below.

## Comparison with baseline

| Metric | Baseline | Default (12) | Ratio | Retry (16) | Ratio | Acceptance |
|---|---:|---:|---:|---:|---:|---|
| PUT 10 MiB (MiB/s) | 1.07 | 0.70 | 0.66x | 0.92 | 0.86x | Fail |
| PUT 100 MiB (MiB/s) | 9.00 | 5.70 | 0.63x | 5.71 | 0.63x | Fail (>2x required) |
| PUT 512 MiB (MiB/s) | 17.09 | 14.01 | 0.82x | 15.81 | 0.93x | Fail (>2x required) |
| GET 10 MiB (MiB/s) | 1.35 | 1.69 | 1.25x | 1.63 | 1.21x | Pass |
| GET 100 MiB (MiB/s) | 17.76 | 8.74 | 0.49x | 11.38 | 0.64x | Fail (>2x required) |
| GET 512 MiB (MiB/s) | 26.20 | 15.96 | 0.61x | 15.32 | 0.58x | Fail (>2x required) |
| HEAD 10 MiB (median ms) | 1724 | 280 | 6.15x faster | 2289 | 0.75x | Default pass; retry noisy |
| DeleteBucket | Failed | Failed | — | Failed | — | Fail |

## Notes

- Large-object throughput missed the target at both concurrency settings; per plan, no Approach B work was started.
- The default HEAD 10 MiB median reached the large-object range (~280 ms). The retry had two slow samples (2726/2289 ms) and one fast sample (278 ms).
- Both runs failed native `DeleteBucket`. The default run also reused a bucket left by the baseline, so its CreateBucket failed; the retry used a fresh bucket and CreateBucket passed.
- `aws s3 cp` server-side copy still attempted unsupported `UploadPartCopy` and failed; this is outside Task 5 acceptance.

Full retry data: `docs/bench/optimized-2026-08-22.json`

