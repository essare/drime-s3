# Production Upload Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make S3 writes preserve the old object on failure, retry transient multipart part failures, and expose the correct ETag immediately after success.

**Architecture:** Normalize every Drime upload response into one `FileEntry`, then pass it through a shared create-first replacement coordinator that persists mandatory ETag metadata before deleting the old entry. Add a short-lived authoritative overlay to the list cache so stale Drive listings cannot resurrect the old entry, and retry replay-safe internal multipart part PUTs locally.

**Tech Stack:** TypeScript 6, Bun 1.3, Bun test, Pino, in-memory Drime test server

## Global Constraints

- Ordinary S3 PUT exposes the full-body MD5, even when transported internally as multipart.
- Client-initiated S3 multipart exposes `MD5(concatenated part MD5 digests)-partCount`.
- Create and verify the candidate before deleting the old entry.
- Never return S3 success before ETag persistence and cache publication complete.
- Retry network errors and HTTP 429, 502, 503, and 504 for buffered part PUTs, at most five total attempts.
- Backoff starts at 250 ms, is capped at 4 seconds, and includes jitter.
- Other 4xx part responses fail immediately.
- The replacement overlay expires after 60 seconds and remains bounded by the cache size limit.
- Never log API keys, authorization headers, request bodies, or presigned URLs.
- Preserve all existing untracked benchmark artifacts; stage only files named by each task.

---

## File Structure

- Create `src/drime/created-entry.ts`: normalize all known Drime created-entry response shapes into a complete `FileEntry`.
- Create `src/s3/object-replacement.ts`: own mandatory ETag persistence, create-first replacement, rollback, stale-delete confirmation, and structured stage errors.
- Modify `src/cache/list-ttl.ts`: apply authoritative replacement overlays to cache hits and fresh/in-flight fetches.
- Modify `src/server-context.ts`: connect replacement-overlay expiry warnings to the application logger.
- Modify `src/drime/multipart-upload.ts`: retry replay-safe part PUTs and separate internal transport ETag from the public ordinary-PUT ETag.
- Modify `src/s3/handlers/object.ts`: route ordinary PUT and copy-object candidates through the replacement coordinator.
- Modify `src/s3/handlers/multipart.ts`: route client multipart candidates through the same coordinator.
- Modify `tests/fixtures/mock-drime/server.ts`: add deterministic response-shape, stale-listing, metadata, delete, and part-upload fault controls.
- Create `tests/unit/drime/created-entry.test.ts`: response normalization tests.
- Modify `tests/unit/cache/list-ttl.test.ts`: overlay and in-flight fetch tests.
- Create `tests/unit/drime/multipart-upload.test.ts`: retry policy tests.
- Create `tests/unit/s3/object-replacement.test.ts`: commit and rollback state-machine tests.
- Modify `tests/integration/object-crud.test.ts`: ordinary PUT overwrite, MD5, and preservation tests.
- Modify `tests/integration/multipart.test.ts`: immediate multipart HEAD, stale listing, and retry tests.
- Modify `package.json`: release version `1.6.2` after all behavior is verified.

---

### Task 1: Normalize Created Drime Entries

**Files:**
- Create: `src/drime/created-entry.ts`
- Create: `tests/unit/drime/created-entry.test.ts`

**Interfaces:**
- Consumes: `FileEntry` and `fromFileEntryJson` from `src/drime/types.ts`.
- Produces:

```typescript
export type CreatedEntryFallback = {
  name: string;
  parentId: number;
  size: number;
  mime: string;
  description: string;
};

export class CreatedEntryError extends Error {}

export function parseCreatedFileEntry(
  raw: unknown,
  fallback: CreatedEntryFallback,
): FileEntry;
```

- [ ] **Step 1: Write failing response-normalization tests**

Create `tests/unit/drime/created-entry.test.ts` with table-driven cases:

```typescript
import { describe, expect, test } from "bun:test";
import {
  CreatedEntryError,
  parseCreatedFileEntry,
} from "../../../src/drime/created-entry";

const fallback = {
  name: "backup.bin",
  parentId: 41,
  size: 123,
  mime: "application/octet-stream",
  description: "md5:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

describe("parseCreatedFileEntry", () => {
  for (const [label, raw] of [
    ["fileEntry", { fileEntry: { id: 7, name: "backup.bin" } }],
    ["file", { file: { id: 7, name: "backup.bin" } }],
    ["entry", { entry: { id: 7, name: "backup.bin" } }],
    ["data", { data: { id: 7, name: "backup.bin" } }],
    ["direct", { id: 7, name: "backup.bin" }],
    ["decimal string id", { fileEntry: { id: "7", name: "backup.bin" } }],
  ] as const) {
    test(`accepts ${label}`, () => {
      const entry = parseCreatedFileEntry(raw, fallback);
      expect(entry.id).toBe(7);
      expect(entry.parent_id).toBe(41);
      expect(entry.file_size).toBe(123);
      expect(entry.description).toBe(fallback.description);
    });
  }

  test("rejects a response without a positive entry id", () => {
    expect(() => parseCreatedFileEntry({ status: "ok" }, fallback)).toThrow(
      CreatedEntryError,
    );
    expect(() =>
      parseCreatedFileEntry({ fileEntry: { id: 0 } }, fallback),
    ).toThrow(CreatedEntryError);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run:

```bash
bun test tests/unit/drime/created-entry.test.ts
```

Expected: FAIL because `src/drime/created-entry.ts` does not exist.

- [ ] **Step 3: Implement the centralized parser**

Create `src/drime/created-entry.ts`. Select `fileEntry`, `file`, `entry`,
`data`, or the direct object; normalize a decimal-string ID before calling
`fromFileEntryJson`; then fill only missing fields from `fallback`.

```typescript
import { fromFileEntryJson, type FileEntry } from "./types";

export type CreatedEntryFallback = {
  name: string;
  parentId: number;
  size: number;
  mime: string;
  description: string;
};

export class CreatedEntryError extends Error {
  readonly name = "CreatedEntryError";
}

function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const nested =
    root.fileEntry ?? root.file ?? root.entry ?? root.data ?? root;
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : null;
}

export function parseCreatedFileEntry(
  raw: unknown,
  fallback: CreatedEntryFallback,
): FileEntry {
  const candidate = unwrap(raw);
  if (!candidate) throw new CreatedEntryError("Created entry is not an object.");
  const parsedId =
    typeof candidate.id === "string" && /^\d+$/.test(candidate.id)
      ? Number(candidate.id)
      : candidate.id;
  if (
    typeof parsedId !== "number" ||
    !Number.isSafeInteger(parsedId) ||
    parsedId <= 0
  ) {
    throw new CreatedEntryError("Created entry response has no valid id.");
  }
  const parsed = fromFileEntryJson({ ...candidate, id: parsedId });
  return {
    ...parsed,
    name: parsed.name || fallback.name,
    parent_id: parsed.parent_id ?? fallback.parentId,
    file_size:
      typeof candidate.file_size === "number"
        ? parsed.file_size
        : fallback.size,
    mime: parsed.mime ?? fallback.mime,
    description: parsed.description ?? fallback.description,
  };
}
```

- [ ] **Step 4: Keep current call sites compiling**

Do not remove the existing private ID parsers in this task. Tasks 5 and 6 remove
them at the same time that each handler adopts `parseCreatedFileEntry`, so every
task remains independently type-correct.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
bun test tests/unit/drime/created-entry.test.ts
bun run typecheck
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/drime/created-entry.ts tests/unit/drime/created-entry.test.ts
git commit -m "refactor(drime): normalize created file entries"
```

---

### Task 2: Add an Authoritative Replacement Overlay

**Files:**
- Modify: `src/cache/list-ttl.ts`
- Modify: `src/server-context.ts:88-95`
- Modify: `tests/unit/cache/list-ttl.test.ts`

**Interfaces:**
- Consumes: existing `FileEntry`, `getOrFetch`, `invalidate`, `addEntry`, and `removeEntryById`.
- Produces:

```typescript
replaceEntry(
  folderId: number | null,
  oldEntryId: number | undefined,
  newEntry: FileEntry,
): void;

export type ReplacementOverlayExpired = {
  folderId: number | null;
  name: string;
  oldEntryId?: number;
  newEntryId: number;
};
```

- [ ] **Step 1: Add failing cache-overlay tests**

Add tests proving that `replaceEntry`:

1. immediately replaces an old cached entry;
2. suppresses a stale same-name entry returned after invalidation;
3. also transforms a fetch that was already in flight when replacement commits;
4. reconciles once raw upstream contains the new ID and not the old ID;
5. expires after 60 seconds.

Use this in-flight case:

```typescript
test("replacement overlays an in-flight stale listing", async () => {
  const cache = new ListTtlCache();
  let release!: (rows: FileEntry[]) => void;
  const upstream = new Promise<FileEntry[]>((resolve) => {
    release = resolve;
  });
  const pending = cache.getOrFetch(7, () => upstream);
  const oldEntry = folderEntry(1, "backup.bin");
  const newEntry = folderEntry(2, "backup.bin");

  cache.replaceEntry(7, oldEntry.id, newEntry);
  release([oldEntry]);

  await expect(pending).resolves.toEqual([newEntry]);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bun test tests/unit/cache/list-ttl.test.ts
```

Expected: FAIL because `replaceEntry` is undefined and stale results are
returned unchanged.

- [ ] **Step 3: Implement overlay storage and merging**

Add:

```typescript
const REPLACEMENT_OVERLAY_MS = 60_000;

type ReplacementOverlay = {
  oldEntryId?: number;
  newEntry: FileEntry;
  expiresAt: number;
};

private readonly replacements = new Map<
  string,
  Map<string, ReplacementOverlay>
>();
```

Key each replacement by exact object name. Add `applyReplacements(k, rows)` that:

- removes `oldEntryId`;
- removes any other row with `row.name === newEntry.name`;
- appends `newEntry`;
- drops the overlay when raw rows contain `newEntry.id` and omit `oldEntryId`;
- drops expired overlays before merging.

Call `applyReplacements` for cache hits and inside `runFetch` before returning
or caching rows. `replaceEntry` must install the overlay and update an existing
cached row without invalidating the folder.

- [ ] **Step 4: Bound overlay memory and report non-convergence**

Accept an optional callback in the cache constructor:

```typescript
constructor(
  private readonly onReplacementExpired: (
    event: ReplacementOverlayExpired,
  ) => void = () => {},
) {}
```

Invoke it once when an expired, unreconciled overlay is pruned. In
`createAppContext`, construct the cache with a callback that logs
`replacement_overlay_expired` at warning level with folder ID, name, and entry
IDs.

Reuse `MAX_CACHED_KEYS` as the hard folder-key bound. Prune expired overlays
before returning:

```typescript
get replacementOverlaySize(): number;
```

Return only the number of active object replacements.

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test tests/unit/cache/list-ttl.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cache/list-ttl.ts src/server-context.ts tests/unit/cache/list-ttl.test.ts
git commit -m "fix(cache): overlay committed object replacements"
```

---

### Task 3: Retry Replay-Safe Internal Multipart Parts

**Files:**
- Modify: `src/drime/multipart-upload.ts:114-150`
- Create: `tests/unit/drime/multipart-upload.test.ts`

**Interfaces:**
- Consumes: `DrimeClient.putUnsignedUrl`, buffered `Buffer` part bodies, and Pino logger from `AppContext`.
- Produces:

```typescript
export type PartRetryOptions = {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};
```

The public upload function accepts an optional test-only `retry` field on
`MultipartUploadOptions`.

- [ ] **Step 1: Write failing deterministic retry tests**

Create `tests/unit/drime/multipart-upload.test.ts` using a temporary file and a
minimal `AppContext`. Inject `sleep: async () => {}` and `random: () => 0`.
Assert:

- responses `[502, 200]` call the unsigned PUT twice and complete;
- a thrown network error followed by 200 completes;
- 429, 503, and 504 retry;
- 400 makes one attempt;
- five 502 responses reject with `Part 1 upload failed after 5 attempts`;
- abort is called once after exhaustion.

- [ ] **Step 2: Run the retry tests and verify failure**

Run:

```bash
bun test tests/unit/drime/multipart-upload.test.ts
```

Expected: FAIL because the first 502 currently aborts the object.

- [ ] **Step 3: Implement one-part retry**

Extract a private `uploadPartWithRetry` that receives the same `Buffer` for
every attempt. Use:

```typescript
const RETRYABLE_PART_STATUSES = new Set([429, 502, 503, 504]);
const PART_MAX_ATTEMPTS = 5;
const PART_BACKOFF_BASE_MS = 250;
const PART_BACKOFF_CAP_MS = 4_000;

function retryDelayMs(attempt: number, random: () => number): number {
  const base = Math.min(
    PART_BACKOFF_CAP_MS,
    PART_BACKOFF_BASE_MS * 2 ** (attempt - 1),
  );
  return Math.floor(base * (0.5 + random() * 0.5));
}
```

Log `upload_part_retry` with `partNumber`, `attempt`, and status/error message.
Do not include the signed URL. Return the successful response so the caller can
capture its ETag.

- [ ] **Step 4: Keep lane concurrency unchanged**

Replace only the direct `ctx.drime.putUnsignedUrl` call inside each lane with
`uploadPartWithRetry`. Do not add nested concurrency and do not retry
`s3MultipartComplete`.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/unit/drime/multipart-upload.test.ts tests/unit/drime/multipart-concurrency.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/drime/multipart-upload.ts tests/unit/drime/multipart-upload.test.ts
git commit -m "fix(multipart): retry transient part uploads"
```

---

### Task 4: Implement the Create-First Replacement Coordinator

**Files:**
- Create: `src/s3/object-replacement.ts`
- Create: `tests/unit/s3/object-replacement.test.ts`
- Modify: `src/drime/client.ts:254-260`

**Interfaces:**
- Consumes: `parseCreatedFileEntry`, `buildObjectDescription`,
  `ListTtlCache.replaceEntry`, `DrimeApiError`, and `AppContext`.
- Produces:

```typescript
export type CommitObjectReplacementOptions = {
  rawCandidate: unknown;
  oldEntry?: FileEntry;
  parentId: number;
  workspaceId: number;
  bucket: string;
  key: string;
  name: string;
  size: number;
  mime: string;
  publicEtag: string;
  tagging: string | null;
};

export class ObjectReplacementError extends Error {
  readonly stage:
    | "candidate_parse"
    | "etag_persist"
    | "old_delete"
    | "candidate_rollback";
}

export async function commitObjectReplacement(
  ctx: AppContext,
  opts: CommitObjectReplacementOptions,
): Promise<FileEntry>;
```

- [ ] **Step 1: Write failing state-machine tests**

Create `tests/unit/s3/object-replacement.test.ts` with a minimal fake context
and ordered call recording. Cover:

- metadata update happens before old deletion;
- success calls `replaceEntry(parentId, oldId, candidate)`;
- metadata failure deletes only the candidate and leaves old untouched;
- old deletion failure deletes the candidate and does not publish;
- candidate rollback failure reports stage `candidate_rollback`;
- no old entry skips deletion;
- invalid candidate response returns `candidate_parse`, logs
  `orphan_candidate`, and never guesses an ID.

- [ ] **Step 2: Run the coordinator tests and verify failure**

Run:

```bash
bun test tests/unit/s3/object-replacement.test.ts
```

Expected: FAIL because `src/s3/object-replacement.ts` does not exist.

- [ ] **Step 3: Add explicit fresh-list support to the Drime client**

Keep `listFolder` as the uncached API operation; the coordinator calls it
directly, bypassing `ListTtlCache`. Add and export:

```typescript
export function isInvalidEntryIdsError(error: unknown): boolean {
  return (
    error instanceof DrimeApiError &&
    error.status === 422 &&
    error.body.includes("selected entry ids is invalid")
  );
}
```

Do not classify every 422 as idempotent success.

- [ ] **Step 4: Implement commit, rollback, and 422 confirmation**

Implement the ordered state machine. Strip surrounding quotes from
`publicEtag`, build the description once, parse the candidate, persist metadata,
then delete old.

When old deletion throws the exact invalid-entry-IDs error, poll
`ctx.drime.listFolder(parentId, workspaceId)` up to five times with
250/500/1000/2000 ms delays. If the old ID disappears, continue as committed.
If it remains, roll back the candidate and throw `old_delete`.

On success, set the candidate description to the persisted description and
call:

```typescript
ctx.listCache.replaceEntry(parentId, opts.oldEntry?.id, candidate);
```

Emit structured messages `candidate_registered`, `etag_persist_failed`,
`old_delete_failed`, `replacement_committed`, and
`replacement_rollback_failed`, including bucket/key and known IDs.

- [ ] **Step 5: Ensure rollback never masks the original stage**

If candidate deletion succeeds, throw the original stage error. If candidate
deletion fails, log both errors and throw `ObjectReplacementError` with stage
`candidate_rollback` and the original error as `cause`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
bun test tests/unit/s3/object-replacement.test.ts tests/unit/drime/client.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/drime/client.ts src/s3/object-replacement.ts tests/unit/s3/object-replacement.test.ts
git commit -m "fix(s3): commit object replacements create-first"
```

---

### Task 5: Route Ordinary PUT and Copy Through the Coordinator

**Files:**
- Modify: `src/drime/multipart-upload.ts:71-79,167-192`
- Modify: `src/s3/handlers/object.ts:190-295,588-663`
- Modify: `tests/integration/object-crud.test.ts`
- Modify: `tests/fixtures/mock-drime/server.ts`

**Interfaces:**
- Consumes: `commitObjectReplacement`.
- Changes `MultipartUploadResult` to return the raw registration response:

```typescript
export type MultipartUploadResult = {
  transportEtag: string;
  size: number;
  entryRaw: unknown;
};
```

The handler, not the transport helper, chooses the public S3 ETag.

- [ ] **Step 1: Add failing ordinary-PUT regression tests**

Extend `tests/integration/object-crud.test.ts` with:

- overwrite `backup.bin` and verify immediate HEAD/GET return new bytes and the
  full-body MD5;
- force the internal multipart threshold below the fixture size and verify PUT
  still returns full-body MD5, not a composite transport ETag;
- inject metadata update failure during overwrite and verify PUT returns 500
  while GET still returns the old bytes;
- inject candidate upload failure and verify the old bytes remain.

Restore `DRIME_S3_MULTIPART_THRESHOLD_BYTES` in `finally`.

- [ ] **Step 2: Run the integration test and verify the failures**

Run:

```bash
bun test tests/integration/object-crud.test.ts
```

Expected: FAIL because delete-first replacement loses the old object and
internal multipart returns a composite ETag.

- [ ] **Step 3: Return raw candidate data from internal multipart**

In `uploadFileViaInternalMultipart`, stop parsing or deciding the externally
visible ETag. Return the transport composite only for diagnostics plus the raw
`s3CreateEntry` response:

```typescript
return {
  transportEtag: compositeMultipartEtag(partEtags),
  size: opts.totalSize,
  entryRaw,
};
```

Delete the private `parseFileEntryId` from this module.

- [ ] **Step 4: Replace delete-first ordinary PUT logic**

Remove the pre-upload `deleteEntriesForever` blocks. After `/uploads` or
internal multipart creates the candidate, call `commitObjectReplacement` with:

```typescript
publicEtag: `"${md5Hex}"`,
oldEntry:
  resolved.kind === "file" || resolved.kind === "folder"
    ? resolved.entry
    : undefined,
```

Return `"${md5Hex}"` from PUT regardless of internal transport. Convert
`ObjectReplacementError` to S3 `InternalError`; retain the existing request
body cleanup in `finally`. Delete `parseUploadFileEntryId`; the coordinator now
uses the central parser.

- [ ] **Step 5: Route copy-object through the same coordinator**

Remove destination deletion before `uploadFile`. Commit the returned candidate
with the computed full-body MD5. Build `CopyObjectResult` only after commit
succeeds.

- [ ] **Step 6: Add mock fault controls needed by tests**

Extend `StartMockDrimeOptions` with deterministic counters:

```typescript
uploadFailureCount?: number;
metadataFailureCount?: number;
deleteFailureCount?: number;
createdEntryShape?: "fileEntry" | "file" | "entry" | "data" | "direct";
```

Consume one failure per matching request and return fixed 500 responses. Keep
defaults identical to current mock behavior.

- [ ] **Step 7: Run ordinary object suites**

Run:

```bash
bun test tests/integration/object-crud.test.ts tests/admin/objects-put.test.ts tests/admin/objects-put-multipart.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/drime/multipart-upload.ts src/s3/handlers/object.ts tests/fixtures/mock-drime/server.ts tests/integration/object-crud.test.ts
git commit -m "fix(s3): preserve objects across failed PUT replacement"
```

---

### Task 6: Route Client Multipart Completion Through the Coordinator

**Files:**
- Modify: `src/s3/handlers/multipart.ts:420-532`
- Modify: `tests/integration/multipart.test.ts`
- Modify: `tests/fixtures/mock-drime/server.ts`

**Interfaces:**
- Consumes: `commitObjectReplacement` and the existing computed `etagOut`.
- Produces: successful CompleteMultipartUpload only after candidate commit and
  cache publication.

- [ ] **Step 1: Add stale-listing and rollback fixtures**

Extend the mock options:

```typescript
staleListingsAfterDelete?: number;
partPutStatuses?: number[];
deleteInvalidIdsCount?: number;
```

For stale listings, retain deleted rows in a separate snapshot and include them
in the next configured number of folder-list responses. For part statuses,
consume one status for `/mock-multipart-put`; store bytes only on a successful
status. For invalid-ID deletion, return the production 422 body.

- [ ] **Step 2: Add failing multipart integration tests**

Extend `tests/integration/multipart.test.ts` with separate tests:

- overwrite an existing key while two post-delete listings remain stale;
- verify Complete response ETag equals immediate HEAD and GET ETag;
- verify the old ID never resurfaces through list;
- metadata failure returns 500 and preserves old bytes;
- confirmed already-absent old ID after 422 still commits the candidate;
- unresolved old deletion rolls back the candidate;
- part status sequence `[502, 200]` completes successfully.

Use two 16-byte parts in the retry case and assert the mock received the failed
part twice but the complete request once.

- [ ] **Step 3: Remove multipart delete-first and swallowed metadata update**

Delete the existing pre-registration old-entry deletion and the optional
`updateFileEntryDescription` block. Delete the handler's private
`parseFileEntryId`. Register the candidate first, then call:

```typescript
await commitObjectReplacement(ctx, {
  rawCandidate: entryRaw,
  oldEntry:
    existing.kind === "file" || existing.kind === "folder"
      ? existing.entry
      : undefined,
  parentId: session.parentId,
  workspaceId: W,
  bucket,
  key: session.key,
  name: filename,
  size: finalSize,
  mime: "application/octet-stream",
  publicEtag: etagOut,
  tagging: null,
});
```

Resolve `existing` before registration but do not mutate it. Delete the
multipart session only after commit succeeds. On coordinator failure, return
S3 `InternalError` and log the stage.

- [ ] **Step 4: Run multipart tests**

Run:

```bash
bun test tests/integration/multipart.test.ts tests/unit/drime/multipart-upload.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/s3/handlers/multipart.ts tests/fixtures/mock-drime/server.ts tests/integration/multipart.test.ts
git commit -m "fix(multipart): publish completed objects consistently"
```

---

### Task 7: Verify Observability, Release Version, and Full Suite

**Files:**
- Modify: `src/s3/router.ts:185-193`
- Modify: `package.json:3`
- Modify: `tests/unit/server-context.test.ts` only if health/cache metrics have a
  focused existing assertion

**Interfaces:**
- Consumes: `ListTtlCache.replacementOverlaySize`.
- Produces: health field `replacementOverlays` and package version `1.6.2`.

- [ ] **Step 1: Expose overlay count in health**

Add:

```typescript
replacementOverlays: ctx.listCache.replacementOverlaySize,
```

to `/_health`. Do not expose bucket names, keys, or entry IDs.

- [ ] **Step 2: Verify no swallowed ETag persistence remains**

Run:

```bash
rg -n 'updateFileEntryDescription|optional Drime feature' src
```

Expected: every object-write metadata call either awaits
`commitObjectReplacement` or has an explicit non-object use case; no object PUT
or multipart complete path contains `catch { /* optional Drime feature */ }`.

- [ ] **Step 3: Run formatting and static checks**

Run:

```bash
bunx biome check --write src/drime/created-entry.ts src/cache/list-ttl.ts src/drime/client.ts src/drime/multipart-upload.ts src/s3/object-replacement.ts src/s3/handlers/object.ts src/s3/handlers/multipart.ts tests/unit/drime/created-entry.test.ts tests/unit/cache/list-ttl.test.ts tests/unit/drime/multipart-upload.test.ts tests/unit/s3/object-replacement.test.ts tests/fixtures/mock-drime/server.ts tests/integration/object-crud.test.ts tests/integration/multipart.test.ts
bun run lint
bun run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
bun test
```

Expected: exit 0 with no failed tests.

- [ ] **Step 5: Bump the patch version**

Change only:

```json
"version": "1.6.2"
```

in `package.json`. Do not create or push a git tag in this task.

- [ ] **Step 6: Build the production artifact**

Run:

```bash
bun run build
```

Expected: exit 0 and produce the release binary/UI under `dist/`.

- [ ] **Step 7: Confirm the diff is scoped**

Run:

```bash
git status --short
git diff --check
git diff --stat main...
```

Expected: only planned source, test, spec, plan, and `package.json` files are
tracked changes; existing benchmark and `python-port/` artifacts remain
untracked and unstaged.

- [ ] **Step 8: Commit**

```bash
git add package.json src/s3/router.ts tests/unit/server-context.test.ts
git commit -m "chore: release v1.6.2"
```

If `tests/unit/server-context.test.ts` was not changed, omit it from `git add`.

---

## Final Production Validation

After the implementation PR is reviewed and its image is published:

1. Deploy the immutable `1.6.2` image with
   `DRIME_S3_MULTIPART_PART_CONCURRENCY=1`.
2. Verify `curl -s http://127.0.0.1:8081/_health` reports version `1.6.2`.
3. Disable the TrueNAS cron temporarily and confirm `docker top rclone` shows
   no competing sync.
4. Sync one isolated prefix containing at least one new object and one
   overwrite larger than 90 MiB.
5. Confirm rclone reports no ETag, MD5, object-not-found, or 502 transfer
   failures.
6. Confirm gateway logs contain `replacement_committed`; they may contain
   recovered `upload_part_retry`, but no `replacement_rollback_failed`.
7. Resume the full sync with `--transfers 1 --checkers 2`, then increase
   concurrency only after a clean observation window.
