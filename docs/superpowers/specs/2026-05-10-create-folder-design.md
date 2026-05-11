# drime-s3 — Create Folder Inside Bucket Design

**Date:** 2026-05-10
**Status:** Approved (brainstorming complete; ready for implementation planning)
**Author:** Brainstorming session output
**Related:**
- [2026-05-09-drime-s3-frontend-design.md](./2026-05-09-drime-s3-frontend-design.md) — UI shell this feature plugs into.
- [2026-05-09-drime-s3-typescript-port-design.md](./2026-05-09-drime-s3-typescript-port-design.md) — gateway architecture.

---

## 1. Goal

Let an operator create an empty folder inside a bucket from the web UI, in the same spirit as the AWS S3 console, Backblaze B2 UI, and Cloudflare R2 console. The folder is created at the user's currently-viewed prefix and the UI navigates into it so files can be uploaded immediately.

## 2. Why this is worth doing

Two reasons:

1. **The Drime model already supports it for free.** Drime has real folders (`POST /folders` returns a `FileEntry` with `is_folder: true`). The gateway already projects every Drime folder as a `CommonPrefix` in S3 listings via `listWithDelimiter`, and `ensureParentFolderForPut` already creates intermediate Drime folders on uploads. There's no new persistence model, no new listing logic — only orchestration and UI.
2. **It matches user mental models from every comparable cloud-storage UI.** AWS S3 console (zero-byte marker), Backblaze B2 (native), R2 console (native), Drime's own UI (native) all expose this. Its absence would be the surprising thing.

The cost is small: one admin endpoint (~50 lines of backend), one dialog + one button (~100 lines of frontend), and a focused test suite.

## 3. Non-Goals (v1)

- **Renaming or moving folders.** Future work.
- **Recursive deletion** of a folder via a single click. Bulk delete via selection already exists; per-folder "delete folder + everything inside" is deferred.
- **Multi-segment paths in one call** (`a/b/c`). Locked to a single segment per dialog submission. Users who want nested structure click in and create again.
- **S3-protocol-level "create folder" endpoint.** AWS CLI users who genuinely need an empty folder can already do `aws s3api put-object --bucket b --key newfolder/` — the existing PUT path creates a Drime folder for the trailing-slash key.
- **Empty-folder garbage collection** when the last object is removed. Drime keeps the folder; we surface it in listings as a `CommonPrefix`. Same behavior as today.

## 4. High-level Decisions (Locked In)

| # | Decision | Choice |
|---|---|---|
| 1 | **Backend storage model** | Drime-native folders. No zero-byte S3 marker objects. |
| 2 | **Path scope per request** | Single segment only (e.g. `2026-photos`). Reject `/` in input. |
| 3 | **Duplicate-name behavior** | Hard `409 FolderAlreadyExists`. Surfaced inline in the dialog. Applies to file collisions too (with `existingKind` field for clearer messaging). |
| 4 | **Post-create UX** | Auto-navigate **into** the new folder by setting `?prefix=<new>/`. |
| 5 | **Where the dialog opens from** | A "New folder" button next to the existing "Upload" button in the object table toolbar. |
| 6 | **Where folders can be created** | At the bucket root **and** at any sub-prefix the user is currently viewing. |

## 5. API Contract

### 5.1 Endpoint

```
POST /_admin/buckets/:bucket/folders[?prefix=<sub/path>]
Cookie: drime_admin=<signed-session>
Origin: <same-origin>
Content-Type: application/json

{ "path": "single-segment-name" }
```

### 5.2 Validation rules (server-authoritative; client mirrors)

| Rule | On failure |
|---|---|
| Body parses as JSON | `400 BadRequest` `"Body must be JSON."` |
| `path` is a non-empty string after `trim()` | `400 BadRequest` `"Field \`path\` is required."` |
| `path.length <= 255` | `400 BadRequest` `"Folder name must be 255 characters or fewer."` |
| `path` does not contain `/` or `\` | `400 BadRequest` `"Slashes are not allowed."` |
| `path` does not contain control chars (`\x00-\x1f` or `\x7f`) | `400 BadRequest` `"Control characters are not allowed."` |
| `path` is not `"."` or `".."` | `400 BadRequest` `"Reserved name."` |
| Bucket exists | `404 NoSuchBucket` |
| Resolved parent prefix exists | `404 NoSuchPrefix` with `"Parent prefix no longer exists; refresh the listing."` |
| Workspace initialized | `503 WorkspaceUnavailable` |
| No name collision (case-insensitive) at the resolved parent | `409 FolderAlreadyExists` with body shown in §5.4 |

### 5.3 Success response

```
HTTP/1.1 201 Created
Content-Type: application/json
Cache-Control: no-store

{ "name": "2026-photos", "prefix": "reports/2026-photos/" }
```

`prefix` is the canonical S3-style path (always ends with `/`) suitable for direct use as `?prefix=` on the listing endpoint **and** as the `prefix` URL search param in the SPA router (the router and listing both accept the trailing slash; existing `onNavigatePrefix` callbacks pass `commonPrefix` strings ending in `/`).

### 5.4 Conflict response (409 body shape)

```
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": {
    "code": "FolderAlreadyExists",
    "message": "A folder named \"photos\" already exists at this location.",
    "details": { "existingKind": "folder" }
  }
}
```

When the collision is with a **file**:

```
{
  "error": {
    "code": "FolderAlreadyExists",
    "message": "An object named \"photos\" already exists at this location.",
    "details": { "existingKind": "file" }
  }
}
```

`existingKind` lets the dialog show a clearer message; the top-level `code` stays the same so callers that don't care about the distinction can match on it directly.

### 5.5 Auth and CSRF

Same as every other admin endpoint: requires a valid `drime_admin` cookie and an `Origin` header matching the request `Host`. Both checks are enforced at the router level (`dispatchAdmin`); no per-handler change.

## 6. Backend Implementation Plan

### 6.1 Files

| File | Change |
|---|---|
| `src/admin/shared.ts` | Add `adminCreateFolder(ctx, W, bucket, prefix, name): Promise<CreateFolderResult>`. |
| `src/admin/handlers/folders.ts` *(new)* | `handleCreateFolderAdmin(ctx, bucket, url, req)`: parses body, calls shared, maps result to JSON response. |
| `src/admin/router.ts` | Wire `POST /_admin/buckets/:bucket/folders` to the new handler. |
| `tests/admin/folders-create.test.ts` *(new)* | Cases enumerated in §3 of the testing matrix below. |

### 6.2 `adminCreateFolder` shape

```ts
export type CreateFolderResult =
  | { kind: "ok"; name: string; prefix: string; id: number }
  | { kind: "no-such-bucket" }
  | { kind: "no-such-prefix" }
  | { kind: "invalid"; message: string }
  | { kind: "exists"; existingKind: "file" | "folder" };

export async function adminCreateFolder(
  ctx: AppContext,
  W: number,
  bucket: string,
  prefix: string, // "" or "sub/path" — no leading/trailing slash
  name: string,
): Promise<CreateFolderResult>;
```

Resolution algorithm:

1. Validate `name` (rules in §5.2). On failure return `{kind:"invalid", message}`.
2. `findRootFolder(ctx, W, bucket)` → bucket root id, else `{kind:"no-such-bucket"}`.
3. If `prefix` is non-empty, walk it under the bucket root using the same case-insensitive `listCache.getOrFetch` traversal as `ensureParentFolderForPut` (read-only — **do not** create missing intermediate segments). If any segment is missing, return `{kind:"no-such-prefix"}` (the handler maps this to `404 NoSuchPrefix`). Rationale: creating folders under a parent that has been concurrently deleted is a stale-UI scenario; better to fail fast than silently materialize a parent the user didn't ask for.
4. List the resolved parent folder via `ctx.listCache.getOrFetch(parentId, ...)`. If any entry has `name.toLowerCase() === name.toLowerCase()`, return `{kind:"exists", existingKind: entry.is_folder ? "folder" : "file"}`.
5. `await ctx.drime.createFolder(name, { parentId, workspaceId: W })`. Parse the response with `parseCreateFolderResponse(raw)` (already exists in `src/s3/handlers/bucket.ts` — extract to a shared util if not already).
6. Seed the cache: `ctx.listCache.addEntry(parentId, buildSeedFolderEntry(raw, id, name))`. The `buildSeedFolderEntry` helper already exists in `src/admin/shared.ts` for `adminCreateBucket` — reuse as-is.
7. Return `{kind:"ok", name, prefix: prefix ? \`${prefix}/${name}/\` : \`${name}/\`, id}`.

### 6.3 Handler

`handleCreateFolderAdmin` is thin:
- Workspace gate (`ctx.gatewayWorkspaceId === null` → 503).
- Parse JSON body; if `path` missing → 400.
- Read `?prefix=` from the URL; trim leading/trailing slashes.
- Call `adminCreateFolder`; map result to response. `{kind:"ok"}` returns `201` with `{name, prefix}`.

### 6.4 Router wiring

Add to `src/admin/router.ts` (where existing `/buckets/:bucket/objects` matchers live):

```ts
const folderMatch = /^\/_admin\/buckets\/([^/]+)\/folders$/.exec(path);
if (method === "POST" && folderMatch) {
  return handleCreateFolderAdmin(ctx, decodeURIComponent(folderMatch[1] ?? ""), url, req);
}
```

Place it adjacent to the `objects` routes so router ordering is obvious.

## 7. Frontend Implementation Plan

### 7.1 Files

| File | Change |
|---|---|
| `web/src/lib/schemas.ts` | Add `CreateFolderResponseSchema` (`{name: string, prefix: string}`). |
| `web/src/lib/api.ts` | No change (uses generic `adminFetchJson`). |
| `web/src/hooks/use-create-folder.ts` *(new)* | TanStack `useMutation` posting to the endpoint, invalidating `objectsKey(bucket, prefix)`, returning typed errors. |
| `web/src/components/objects/create-folder-dialog.tsx` *(new)* | Shadcn `Dialog` with controlled input, react-hook-form + zod, inline 409, calls the hook. |
| `web/src/pages/bucket-detail.tsx` | Add `createFolderOpen` state; render the dialog; replace the `toolbarRight` `<Button>` with a `<div>` that contains both **New folder** (outline variant) and **Upload** (default). |
| `web/src/pages/bucket-detail.test.tsx` | Extend to verify the new button is present and clicking it opens the dialog. |
| `web/src/components/objects/create-folder-dialog.test.tsx` *(new)* | Validation + submit + 409 handling. |
| `web/src/hooks/use-create-folder.test.tsx` *(new)* | Hook unit tests. |

### 7.2 Validation (zod, mirrored from server)

```ts
const folderNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(255, "Name too long")
  .refine((n) => !/[\\/]/.test(n), "Slashes are not allowed")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: validating user input against control chars
  .refine((n) => !/[\x00-\x1f\x7f]/.test(n), "Control characters are not allowed")
  .refine((n) => n !== "." && n !== "..", "Reserved name");
```

### 7.3 Mutation hook

```ts
type CreateFolderArgs = { bucket: string; prefix: string; name: string };

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bucket, prefix, name }: CreateFolderArgs) => {
      const url = new URL(
        `/_admin/buckets/${encodeURIComponent(bucket)}/folders`,
        window.location.origin,
      );
      if (prefix) url.searchParams.set("prefix", prefix);
      return adminFetchJson(url.pathname + url.search, {
        method: "POST",
        body: { path: name },
        schema: CreateFolderResponseSchema,
      });
    },
    onSuccess: (_data, { bucket, prefix }) => {
      void qc.invalidateQueries({ queryKey: objectsKey(bucket, prefix) });
    },
  });
}
```

### 7.4 Dialog UX

- Title: **"Create folder"**, description: `In <code>{prefix || bucket}</code>`.
- Single text input, autofocus, max-length 255.
- Submit button: **"Create"**, disabled while `isPending`.
- On `AdminApiError` with `code === "FolderAlreadyExists"`, set the error inline on the input field with a name-aware message: `A folder named "<name>" already exists here.` (or `An object named "<name>" already exists here.` if `details.existingKind === "file"`).
- On any other error, show a non-field-level `Alert` inside the dialog with the message.
- On success: the dialog's `onSuccess` callback (passed in from `BucketDetailPage`) receives the response payload and calls `setSearchParams({prefix: data.prefix})` directly — `data.prefix` already includes the trailing slash, matching the convention used by `ObjectTable.onNavigatePrefix` (which passes `fullPrefix` ending in `/`). The dialog then closes and fires `toast.success("Folder created")`.

### 7.5 Toolbar layout

Replace the current `toolbarRight` content in `bucket-detail.tsx`:

```tsx
toolbarRight={
  <div className="flex items-center gap-2">
    <Button
      type="button"
      variant="outline"
      onClick={() => setCreateFolderOpen(true)}
    >
      <FolderPlus className="size-4" aria-hidden />
      New folder
    </Button>
    <Button type="button" onClick={() => fileInputRef.current?.click()}>
      Upload
    </Button>
  </div>
}
```

Icon comes from `lucide-react` (already a dependency).

## 8. Testing

### 8.1 Backend (`tests/admin/folders-create.test.ts`)

| # | Case | Expected |
|---|---|---|
| 1 | Root-level happy path | 201, `{name:"reports", prefix:"reports/"}`. Subsequent `GET /_admin/buckets/docs/objects?prefix=` includes `reports/` in `commonPrefixes`. |
| 2 | Same call again | 409 `FolderAlreadyExists`, `details.existingKind: "folder"`. |
| 3 | Sub-prefix happy path (`?prefix=reports/`) | 201, `{prefix:"reports/q1/"}`. Listing under `reports/` shows `q1/`. |
| 4 | Collision with an existing **file** | 409 `FolderAlreadyExists`, `details.existingKind: "file"`. |
| 5 | Empty / whitespace `path` | 400 `BadRequest`. |
| 6 | `path` containing `/` or `\` | 400 `BadRequest`. |
| 7 | `path === "."` or `".."` | 400 `BadRequest`. |
| 8 | `path.length === 256` | 400 `BadRequest`. |
| 9 | `path` containing `\x00`/`\x7f` | 400 `BadRequest`. |
| 10 | Bucket missing | 404 `NoSuchBucket`. |
| 10b | Parent prefix vanished between page load and POST | 404 `NoSuchPrefix`. |
| 11 | `gatewayWorkspaceId === null` | 503 `WorkspaceUnavailable`. |
| 12 | Missing cookie | 401 `Unauthorized` (router-level). |
| 13 | Cross-origin POST | 403 (router-level CSRF). |
| 14 | Read-your-writes | The same `Setup`, immediately after a 201, calling the listing endpoint returns the new folder in `commonPrefixes`. Guards the `addEntry` cache-seeding pattern. |

### 8.2 Frontend

`web/src/components/objects/create-folder-dialog.test.tsx`:
- Renders dialog when `open={true}`.
- Inline validation for empty / `/` / too-long / control char / `.`/ `..`.
- On submit, calls the mocked mutation with correct args.
- 409 with `existingKind:"file"` shows the file-specific message.
- 409 with `existingKind:"folder"` shows the folder-specific message.

`web/src/hooks/use-create-folder.test.tsx`:
- POSTs to `/_admin/buckets/<b>/folders?prefix=<p>` (with prefix omitted when empty).
- On 201, invalidates the right `objectsKey`.
- Surfaces `AdminApiError` with code & details preserved.

`web/src/pages/bucket-detail.test.tsx` (extension):
- New folder button is rendered in the toolbar.
- Clicking it opens the dialog.
- After successful creation (mocked), `setSearchParams` is called with the new prefix.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Race: user creates folder from UI A while UI B's `objectsKey` is cached. | Both clients re-fetch listings on focus; the gateway's `addEntry` only affects the local cache, so a remote tab is no different from any other concurrent change. Acceptable. |
| Drime's response shape for `POST /folders` differs from `parseCreateFolderResponse` expectations. | Already handled by `parseCreateFolderResponse` (battle-tested by `adminCreateBucket`). New tests catch any regression. |
| Empty Drime folders pollute the namespace if user creates many and abandons. | Same risk exists today via `ensureParentFolderForPut` on aborted uploads. Acceptable; future cleanup tooling out of scope. |
| Case-insensitive collision rule surprises the user (e.g., they type `Photos` but `photos` already exists). | The 409 message includes the existing name verbatim: `A folder named "photos" already exists here (names are case-insensitive).` |

## 10. Rollout

This is purely additive: a new endpoint, new components, no change to the S3 protocol path or any existing admin endpoint. No migrations. No new env vars. Ships behind no feature flag — landing this means the button appears in the next deploy.

## 11. Open Questions

None.
