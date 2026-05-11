# Create Folder Inside Bucket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "New folder" button to the bucket detail page that creates an empty Drime folder at the user's currently-viewed prefix and auto-navigates into it.

**Architecture:** New admin endpoint `POST /_admin/buckets/:bucket/folders` (single-segment names only, hard 409 on duplicate, 404 on missing parent prefix). Server reuses Drime's native folder model and seeds `listCache` for read-your-writes. Frontend adds a Shadcn Dialog and a TanStack Query mutation that invalidates the current `objectsKey` and updates the URL search param.

**Tech Stack:** Bun + TypeScript (backend), React 19 + Vite + TanStack Query 5 + react-hook-form + zod + Shadcn UI (frontend), `bun:test` (backend tests), Vitest + Testing Library (frontend tests).

**Spec:** [`docs/superpowers/specs/2026-05-10-create-folder-design.md`](../specs/2026-05-10-create-folder-design.md).

---

## File Structure (target)

| File | Purpose |
|---|---|
| `src/admin/shared.ts` *(modify)* | Export `buildSeedFolderEntry`; add `CreateFolderResult` type and `adminCreateFolder` orchestration. |
| `src/admin/handlers/folders.ts` *(create)* | `handleCreateFolderAdmin` — JSON body parse, prefix from query, map result to JSON response. |
| `src/admin/router.ts` *(modify)* | Wire `POST /_admin/buckets/:bucket/folders` to the new handler. |
| `tests/admin/folders-create.test.ts` *(create)* | All 14 backend cases from spec §8.1. |
| `web/src/lib/folder-name.ts` *(create)* | Shared zod schema for folder names (mirrors backend validation). |
| `web/src/lib/schemas.ts` *(modify)* | Add `CreateFolderResponseSchema`. |
| `web/src/hooks/use-create-folder.ts` *(create)* | TanStack `useMutation` posting to the new endpoint, invalidates `objectsKey`. |
| `web/src/components/objects/create-folder-dialog.tsx` *(create)* | Shadcn `Dialog` with form + inline 409 handling. |
| `web/src/pages/bucket-detail.tsx` *(modify)* | Add `createFolderOpen` state; render the dialog; add "New folder" button next to "Upload". |
| `web/src/components/objects/create-folder-dialog.test.tsx` *(create)* | Validation, submit, 409 messaging tests. |
| `web/src/hooks/use-create-folder.test.tsx` *(create)* | Hook unit tests (URL shape + invalidation). |
| `web/src/pages/bucket-detail.test.tsx` *(modify)* | Verify the new button is present and opens the dialog. |

## How to run things

- Backend tests: `bun test tests/admin/folders-create.test.ts` (focused) or `bun test` (full).
- Backend lint: `bunx @biomejs/biome check --write src/admin/ tests/admin/`.
- Frontend tests: `bun run --cwd web test` (Vitest) or `bunx vitest run <path>` from `web/`.
- Frontend lint: `bun run --cwd web lint`.
- Manual end-to-end: `bun run start` (gateway on 8081), `bun run --cwd web dev` (Vite on 5173), open `http://localhost:5173/_ui/buckets/<bucket>` and try the New folder button.

## Conventions used by this plan

- **TDD throughout.** Every backend task: write the test → run it → see it fail → implement → run it → see it pass → commit. Every frontend task likewise.
- **One commit per task.** Subject line follows existing style: `feat(admin): …`, `feat(web): …`, `test(admin): …`, `test(web): …`, `chore(admin): …`.
- **Don't pre-commit untouched files.** `git add` only the files listed in each task's "Files" section.

---

## Phase 1 — Backend

### Task 1: Export `buildSeedFolderEntry` and add `CreateFolderResult` type

**Files:**
- Modify: `src/admin/shared.ts`

- [ ] **Step 1: Export `buildSeedFolderEntry`**

  In `src/admin/shared.ts`, change the helper from `function buildSeedFolderEntry(...)` to `export function buildSeedFolderEntry(...)`. No body changes.

- [ ] **Step 2: Add the `CreateFolderResult` discriminated union near `CreateBucketResult`**

```ts
export type CreateFolderResult =
  | { kind: "ok"; name: string; prefix: string; id: number }
  | { kind: "no-such-bucket" }
  | { kind: "no-such-prefix" }
  | { kind: "invalid"; message: string }
  | { kind: "exists"; existingKind: "file" | "folder" };
```

- [ ] **Step 3: Typecheck**

  Run: `bunx tsc --noEmit`
  Expected: no new errors (the pre-existing `tests/admin/stats.test.ts` typing issue is unrelated and out of scope).

- [ ] **Step 4: Commit**

```bash
git add src/admin/shared.ts
git commit -m "chore(admin): export buildSeedFolderEntry and add CreateFolderResult type"
```

---

### Task 2: Write a failing test for `adminCreateFolder` (root-level happy path)

**Files:**
- Test: `tests/admin/folders-create.test.ts` *(create)*

- [ ] **Step 1: Create the test file with the first happy-path case**

```ts
import { describe, expect, test } from "bun:test";
import { loginCookie, startAdmin } from "./helpers";

const ORIG = "http://127.0.0.1:8081";
function H(cookie: string) {
  return {
    Host: "127.0.0.1:8081",
    Cookie: cookie,
    Origin: ORIG,
    "Content-Type": "application/json",
  };
}

describe("POST /_admin/buckets/:b/folders", () => {
  test("creates a folder at the bucket root", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const res = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "reports" }),
        }),
      );
      expect(res.status).toBe(201);
      const j = (await res.json()) as { name: string; prefix: string };
      expect(j).toEqual({ name: "reports", prefix: "reports/" });

      const listed = await setup.call(
        new Request(
          `${ORIG}/_admin/buckets/docs/objects?delimiter=/&prefix=`,
          { headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG } },
        ),
      );
      const lj = (await listed.json()) as { commonPrefixes: string[] };
      expect(lj.commonPrefixes).toContain("reports/");
    } finally {
      setup.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

  Run: `bun test tests/admin/folders-create.test.ts`
  Expected: 1 fail. The dispatcher returns `404 NotFound` because no route matches yet.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/admin/folders-create.test.ts
git commit -m "test(admin): failing test for POST /_admin/buckets/:b/folders root happy path"
```

---

### Task 3: Implement `adminCreateFolder` orchestration

**Files:**
- Modify: `src/admin/shared.ts`

- [ ] **Step 1: Add the function at the end of the file**

  Add to `src/admin/shared.ts` (full implementation — no placeholders):

```ts
const FOLDER_NAME_MAX = 255;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

function validateFolderName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, message: "Folder name is required." };
  if (name.length > FOLDER_NAME_MAX) {
    return { ok: false, message: `Folder name must be ${FOLDER_NAME_MAX} characters or fewer.` };
  }
  if (/[/\\]/.test(name)) return { ok: false, message: "Slashes are not allowed." };
  if (CONTROL_CHAR_RE.test(name)) return { ok: false, message: "Control characters are not allowed." };
  if (name === "." || name === "..") return { ok: false, message: "Reserved name." };
  return { ok: true, name };
}

async function resolvePrefixUnder(
  ctx: AppContext,
  W: number,
  bucketRootId: number,
  prefix: string,
): Promise<number | "missing"> {
  const trimmed = prefix.replace(/^\/+|\/+$/g, "");
  if (trimmed.length === 0) return bucketRootId;
  const parts = trimmed.split("/").filter(Boolean);
  let currentId = bucketRootId;
  for (const part of parts) {
    const entries = await ctx.listCache.getOrFetch(currentId, () =>
      ctx.drime.listFolder(currentId, W),
    );
    const found = entries.find(
      (e) => e.is_folder && e.name.toLowerCase() === part.toLowerCase(),
    );
    if (!found) return "missing";
    currentId = found.id;
  }
  return currentId;
}

export async function adminCreateFolder(
  ctx: AppContext,
  W: number,
  bucket: string,
  prefix: string,
  rawName: string,
): Promise<CreateFolderResult> {
  const validation = validateFolderName(rawName);
  if (!validation.ok) return { kind: "invalid", message: validation.message };
  const { name } = validation;

  const root = await findRootFolder(ctx, W, bucket);
  if (root === undefined) return { kind: "no-such-bucket" };

  const parentResolved = await resolvePrefixUnder(ctx, W, root.id, prefix);
  if (parentResolved === "missing") return { kind: "no-such-prefix" };
  const parentId = parentResolved;

  const siblings = await ctx.listCache.getOrFetch(parentId, () =>
    ctx.drime.listFolder(parentId, W),
  );
  const collision = siblings.find(
    (e) => e.name.toLowerCase() === name.toLowerCase(),
  );
  if (collision) {
    return {
      kind: "exists",
      existingKind: collision.is_folder ? "folder" : "file",
    };
  }

  const raw = await ctx.drime.createFolder(name, { parentId, workspaceId: W });
  const id = parseCreateFolderResponse(raw);
  if (id === undefined) {
    ctx.listCache.invalidate(parentId);
    const trimmedPrefix = prefix.replace(/^\/+|\/+$/g, "");
    return {
      kind: "ok",
      name,
      prefix: trimmedPrefix ? `${trimmedPrefix}/${name}/` : `${name}/`,
      id: -1,
    };
  }
  ctx.listCache.addEntry(parentId, buildSeedFolderEntry(raw, id, name));
  const trimmedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return {
    kind: "ok",
    name,
    prefix: trimmedPrefix ? `${trimmedPrefix}/${name}/` : `${name}/`,
    id,
  };
}
```

  Note: the `id: -1` fallback when Drime returns an unexpected shape mirrors the existing `adminCreateBucket` "Couldn't extract id; fall back to invalidate" path. The handler still returns 201 so the UI can refetch.

- [ ] **Step 2: Typecheck**

  Run: `bunx tsc --noEmit`
  Expected: no new errors.

- [ ] **Step 3: Commit (test still fails — handler+router don't exist yet)**

```bash
git add src/admin/shared.ts
git commit -m "feat(admin): adminCreateFolder shared orchestration"
```

---

### Task 4: Add `handleCreateFolderAdmin` and wire the router

**Files:**
- Create: `src/admin/handlers/folders.ts`
- Modify: `src/admin/router.ts`

- [ ] **Step 1: Create the handler**

```ts
import type { AppContext } from "../../server-context";
import { jsonError, jsonOk } from "../errors";
import { adminCreateFolder } from "../shared";

function workspaceUnavailable(): Response {
  return jsonError(
    "WorkspaceUnavailable",
    "Gateway workspace not initialized — call POST /_admin/init.",
    503,
  );
}

export async function handleCreateFolderAdmin(
  ctx: AppContext,
  bucket: string,
  url: URL,
  req: Request,
): Promise<Response> {
  if (ctx.gatewayWorkspaceId === null) return workspaceUnavailable();

  let body: { path?: unknown };
  try {
    body = (await req.json()) as { path?: unknown };
  } catch {
    return jsonError("BadRequest", "Body must be JSON.", 400);
  }
  const path = typeof body.path === "string" ? body.path : "";
  if (!path) {
    return jsonError("BadRequest", "Field `path` is required.", 400);
  }

  const prefix = (url.searchParams.get("prefix") ?? "").replace(
    /^\/+|\/+$/g,
    "",
  );

  const r = await adminCreateFolder(
    ctx,
    ctx.gatewayWorkspaceId,
    bucket,
    prefix,
    path,
  );

  if (r.kind === "no-such-bucket") {
    return jsonError(
      "NoSuchBucket",
      "The specified bucket does not exist.",
      404,
    );
  }
  if (r.kind === "no-such-prefix") {
    return jsonError(
      "NoSuchPrefix",
      "Parent prefix no longer exists; refresh the listing.",
      404,
    );
  }
  if (r.kind === "invalid") {
    return jsonError("BadRequest", r.message, 400);
  }
  if (r.kind === "exists") {
    const noun = r.existingKind === "folder" ? "folder" : "object";
    return jsonError(
      "FolderAlreadyExists",
      `A ${noun} named "${path.trim()}" already exists at this location.`,
      409,
      { existingKind: r.existingKind },
    );
  }
  return jsonOk({ name: r.name, prefix: r.prefix }, { status: 201 });
}
```

- [ ] **Step 2: Confirm `jsonError` accepts `details` and `jsonOk` accepts `status`**

  Run: `rg -n "export function (jsonError|jsonOk)" src/admin/errors.ts`
  If `jsonError` does not accept a `details` parameter, add it (4th argument, optional, merged into `error.details` if defined). If `jsonOk` does not accept `{ status }`, add it. Existing handlers (e.g. `handleCreateBucketAdmin`) demonstrate the conventional shape — match that.

- [ ] **Step 3: Wire the route in `src/admin/router.ts`**

  Add the import alongside the others:

```ts
import { handleCreateFolderAdmin } from "./handlers/folders";
```

  Add the route immediately after the `bucketOnly` block and before `objectsList`:

```ts
const folderCreate = /^\/_admin\/buckets\/([^/]+)\/folders$/.exec(path);
if (folderCreate && method === "POST") {
  return handleCreateFolderAdmin(
    ctx,
    decodeURIComponent(folderCreate[1] ?? ""),
    url,
    req,
  );
}
```

- [ ] **Step 4: Run the test**

  Run: `bun test tests/admin/folders-create.test.ts`
  Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/admin/handlers/folders.ts src/admin/router.ts src/admin/errors.ts
git commit -m "feat(admin): POST /_admin/buckets/:b/folders endpoint"
```

  (Only include `errors.ts` if you actually modified it in step 2.)

---

### Task 5: Add the remaining backend test cases (validation, conflicts, gates)

**Files:**
- Modify: `tests/admin/folders-create.test.ts`

- [ ] **Step 1: Append the rest of the cases**

  After the existing `test(...)` block but inside the same `describe`, add (each case as a separate `test(...)` for clear failure isolation):

```ts
  test("creates a folder under a sub-prefix", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      // First create reports/ at the root.
      let r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "reports" }),
        }),
      );
      expect(r.status).toBe(201);
      r = await setup.call(
        new Request(
          `${ORIG}/_admin/buckets/docs/folders?prefix=reports`,
          {
            method: "POST",
            headers: H(cookie),
            body: JSON.stringify({ path: "q1" }),
          },
        ),
      );
      expect(r.status).toBe(201);
      const j = (await r.json()) as { name: string; prefix: string };
      expect(j).toEqual({ name: "q1", prefix: "reports/q1/" });
    } finally {
      setup.cleanup();
    }
  });

  test("409 FolderAlreadyExists on duplicate folder", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "reports" }),
        }),
      );
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "REPORTS" }),
        }),
      );
      expect(r.status).toBe(409);
      const j = (await r.json()) as {
        error: { code: string; details?: { existingKind?: string } };
      };
      expect(j.error.code).toBe("FolderAlreadyExists");
      expect(j.error.details?.existingKind).toBe("folder");
    } finally {
      setup.cleanup();
    }
  });

  test("409 FolderAlreadyExists when an object with the same name exists", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      // Upload an object named "notes" at the root via S3 path.
      await setup.call(
        new Request(`${ORIG}/docs/notes`, {
          method: "PUT",
          headers: { Host: "127.0.0.1:8081", "Content-Length": "5" },
          body: "hello",
        }),
      );
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "notes" }),
        }),
      );
      expect(r.status).toBe(409);
      const j = (await r.json()) as {
        error: { details?: { existingKind?: string } };
      };
      expect(j.error.details?.existingKind).toBe("file");
    } finally {
      setup.cleanup();
    }
  });

  test("400 BadRequest on missing/empty/whitespace path", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      for (const body of [
        JSON.stringify({}),
        JSON.stringify({ path: "" }),
        JSON.stringify({ path: "   " }),
      ]) {
        const r = await setup.call(
          new Request(`${ORIG}/_admin/buckets/docs/folders`, {
            method: "POST",
            headers: H(cookie),
            body,
          }),
        );
        expect(r.status).toBe(400);
      }
    } finally {
      setup.cleanup();
    }
  });

  test("400 BadRequest on illegal characters or reserved names", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const bad = ["a/b", "a\\b", ".", "..", "x\x00y", "x".repeat(256)];
      for (const path of bad) {
        const r = await setup.call(
          new Request(`${ORIG}/_admin/buckets/docs/folders`, {
            method: "POST",
            headers: H(cookie),
            body: JSON.stringify({ path }),
          }),
        );
        expect(r.status).toBe(400);
      }
    } finally {
      setup.cleanup();
    }
  });

  test("404 NoSuchBucket when bucket does not exist", async () => {
    const setup = await startAdmin({ password: "hunter2-hunter2" });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/nope/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "x" }),
        }),
      );
      expect(r.status).toBe(404);
      const j = (await r.json()) as { error: { code: string } };
      expect(j.error.code).toBe("NoSuchBucket");
    } finally {
      setup.cleanup();
    }
  });

  test("404 NoSuchPrefix when parent prefix does not exist", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const r = await setup.call(
        new Request(
          `${ORIG}/_admin/buckets/docs/folders?prefix=does/not/exist`,
          {
            method: "POST",
            headers: H(cookie),
            body: JSON.stringify({ path: "x" }),
          },
        ),
      );
      expect(r.status).toBe(404);
      const j = (await r.json()) as { error: { code: string } };
      expect(j.error.code).toBe("NoSuchPrefix");
    } finally {
      setup.cleanup();
    }
  });

  test("401 Unauthorized without cookie", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: { Host: "127.0.0.1:8081", Origin: ORIG, "Content-Type": "application/json" },
          body: JSON.stringify({ path: "x" }),
        }),
      );
      expect(r.status).toBe(401);
    } finally {
      setup.cleanup();
    }
  });

  test("403 cross-origin POST is rejected", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const r = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: {
            Host: "127.0.0.1:8081",
            Cookie: cookie,
            Origin: "http://evil.example.com",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: "x" }),
        }),
      );
      expect(r.status).toBe(403);
    } finally {
      setup.cleanup();
    }
  });

  test("read-your-writes: listing immediately after create includes the new folder", async () => {
    const setup = await startAdmin({
      password: "hunter2-hunter2",
      seedRootFolders: ["docs"],
    });
    try {
      const cookie = await loginCookie(setup, "hunter2-hunter2");
      const create = await setup.call(
        new Request(`${ORIG}/_admin/buckets/docs/folders`, {
          method: "POST",
          headers: H(cookie),
          body: JSON.stringify({ path: "fresh" }),
        }),
      );
      expect(create.status).toBe(201);
      const list = await setup.call(
        new Request(
          `${ORIG}/_admin/buckets/docs/objects?delimiter=/&prefix=`,
          { headers: { Host: "127.0.0.1:8081", Cookie: cookie, Origin: ORIG } },
        ),
      );
      const lj = (await list.json()) as { commonPrefixes: string[] };
      expect(lj.commonPrefixes).toContain("fresh/");
    } finally {
      setup.cleanup();
    }
  });
```

- [ ] **Step 2: Run the suite**

  Run: `bun test tests/admin/folders-create.test.ts`
  Expected: all tests PASS. If any fail, fix the implementation in `shared.ts` or `folders.ts` to match — do not change the tests.

- [ ] **Step 3: Run the full backend suite to check for regressions**

  Run: `bun test`
  Expected: PASS for the full count (was 181 before this plan; should now be 181 + N where N is the number of new tests in this file).

- [ ] **Step 4: Lint**

  Run: `bunx @biomejs/biome check --write src/admin/ tests/admin/`
  Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add tests/admin/folders-create.test.ts src/admin/handlers/folders.ts src/admin/shared.ts src/admin/router.ts
git commit -m "test(admin): full coverage for POST /_admin/buckets/:b/folders"
```

---

## Phase 2 — Frontend

### Task 6: Add the shared folder-name zod schema and response schema

**Files:**
- Create: `web/src/lib/folder-name.ts`
- Modify: `web/src/lib/schemas.ts`

- [ ] **Step 1: Create `folder-name.ts`**

```ts
import { z } from "zod";

export const FOLDER_NAME_MAX = 255;

export const folderNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(FOLDER_NAME_MAX, `Name must be ${FOLDER_NAME_MAX} characters or fewer`)
  .refine((n) => !/[\\/]/.test(n), "Slashes are not allowed")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: validating user input
  .refine((n) => !/[\x00-\x1f\x7f]/.test(n), "Control characters are not allowed")
  .refine((n) => n !== "." && n !== "..", "Reserved name");
```

- [ ] **Step 2: Add the response schema in `schemas.ts`**

  Add (next to `BucketCreatedSchema`):

```ts
export const CreateFolderResponseSchema = z.object({
  name: z.string(),
  prefix: z.string(),
});
export type CreateFolderResponse = z.infer<typeof CreateFolderResponseSchema>;
```

- [ ] **Step 3: Typecheck**

  Run: `bun run --cwd web typecheck`
  Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/folder-name.ts web/src/lib/schemas.ts
git commit -m "feat(web): folder-name zod schema and CreateFolderResponse"
```

---

### Task 7: Write a failing test for `useCreateFolder`

**Files:**
- Test: `web/src/hooks/use-create-folder.test.tsx` *(create)*

- [ ] **Step 1: Create the test**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCreateFolder } from "./use-create-folder";

function wrapper(client: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useCreateFolder", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the right URL with prefix omitted when empty and invalidates objectsKey", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "reports", prefix: "reports/" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        bucket: "docs",
        prefix: "",
        name: "reports",
      });
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/_admin/buckets/docs/folders");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ path: "reports" }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin", "objects", "docs", { prefix: "", delimiter: "/" }],
      }),
    );
  });

  it("attaches ?prefix=<p> when prefix is non-empty", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "q1", prefix: "reports/q1/" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useCreateFolder(), {
      wrapper: wrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        bucket: "docs",
        prefix: "reports/",
        name: "q1",
      });
    });
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/_admin/buckets/docs/folders?prefix=reports");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

  Run: `bun run --cwd web test -- src/hooks/use-create-folder.test.tsx`
  Expected: FAIL — module `./use-create-folder` does not exist.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/use-create-folder.test.tsx
git commit -m "test(web): failing tests for useCreateFolder"
```

---

### Task 8: Implement `useCreateFolder`

**Files:**
- Create: `web/src/hooks/use-create-folder.ts`

- [ ] **Step 1: Implement the hook**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetchJson } from "@/lib/api";
import { objectsKey } from "@/lib/query-keys";
import { CreateFolderResponseSchema } from "@/lib/schemas";

export type CreateFolderArgs = {
  bucket: string;
  prefix: string;
  name: string;
};

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bucket, prefix, name }: CreateFolderArgs) => {
      const trimmed = prefix.replace(/^\/+|\/+$/g, "");
      const path = `/_admin/buckets/${encodeURIComponent(bucket)}/folders${trimmed ? `?prefix=${encodeURIComponent(trimmed)}` : ""}`;
      return adminFetchJson(path, {
        method: "POST",
        body: { path: name },
        schema: CreateFolderResponseSchema,
      });
    },
    onSuccess: (_data, { bucket, prefix }) => {
      void qc.invalidateQueries({
        queryKey: objectsKey(bucket, { prefix, delimiter: "/" }),
      });
    },
  });
}
```

- [ ] **Step 2: Run the tests and confirm they pass**

  Run: `bun run --cwd web test -- src/hooks/use-create-folder.test.tsx`
  Expected: 2 PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/use-create-folder.ts
git commit -m "feat(web): useCreateFolder mutation hook"
```

---

### Task 9: Write failing tests for `CreateFolderDialog`

**Files:**
- Test: `web/src/components/objects/create-folder-dialog.test.tsx` *(create)*

- [ ] **Step 1: Create the test file**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateFolderDialog } from "./create-folder-dialog";

function withProviders(client: QueryClient) {
  return function Wrap({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    );
  };
}

describe("CreateFolderDialog", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits a valid name and calls onSuccess with the response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "reports", prefix: "reports/" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={onOpenChange}
        bucket="docs"
        prefix=""
        onSuccess={onSuccess}
      />,
      { wrapper: withProviders(client) },
    );

    await userEvent.type(screen.getByLabelText(/folder name/i), "reports");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    await vi.waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({
        name: "reports",
        prefix: "reports/",
      });
    });
  });

  it("rejects a name containing a slash without calling fetch", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={() => {}}
        bucket="docs"
        prefix=""
        onSuccess={() => {}}
      />,
      { wrapper: withProviders(client) },
    );
    await userEvent.type(screen.getByLabelText(/folder name/i), "a/b");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/slashes are not allowed/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the folder-specific 409 message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "FolderAlreadyExists",
            message: 'A folder named "reports" already exists at this location.',
            details: { existingKind: "folder" },
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={() => {}}
        bucket="docs"
        prefix=""
        onSuccess={() => {}}
      />,
      { wrapper: withProviders(client) },
    );
    await userEvent.type(screen.getByLabelText(/folder name/i), "reports");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(
      await screen.findByText(/a folder named .* already exists/i),
    ).toBeInTheDocument();
  });

  it("shows the file-specific 409 message", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "FolderAlreadyExists",
            message: 'An object named "notes" already exists at this location.',
            details: { existingKind: "file" },
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <CreateFolderDialog
        open={true}
        onOpenChange={() => {}}
        bucket="docs"
        prefix=""
        onSuccess={() => {}}
      />,
      { wrapper: withProviders(client) },
    );
    await userEvent.type(screen.getByLabelText(/folder name/i), "notes");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(
      await screen.findByText(/an object named .* already exists/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

  Run: `bun run --cwd web test -- src/components/objects/create-folder-dialog.test.tsx`
  Expected: FAIL — module does not exist.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/objects/create-folder-dialog.test.tsx
git commit -m "test(web): failing tests for CreateFolderDialog"
```

---

### Task 10: Implement `CreateFolderDialog`

**Files:**
- Create: `web/src/components/objects/create-folder-dialog.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useCreateFolder } from "@/hooks/use-create-folder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { AdminApiError } from "@/lib/api";
import { folderNameSchema } from "@/lib/folder-name";
import type { CreateFolderResponse } from "@/lib/schemas";

const formSchema = z.object({ name: folderNameSchema });
type FormValues = z.infer<typeof formSchema>;

export type CreateFolderDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  bucket: string;
  prefix: string;
  onSuccess: (data: CreateFolderResponse) => void;
};

export function CreateFolderDialog({
  open,
  onOpenChange,
  bucket,
  prefix,
  onSuccess,
}: CreateFolderDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "" },
  });

  const mutation = useCreateFolder();

  // NOTE (post-implementation): Spec §7.4 prescribes an inline `Alert`
  // (NOT a toast) for non-field errors. The shipped dialog tracks a
  // `generalError` string + renders `<Alert variant="destructive">` inside
  // the form. The snippet below shows the original `toast.error` path for
  // reference; the actual implementation is in
  // `web/src/components/objects/create-folder-dialog.tsx`.
  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) form.reset({ name: "" });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create folder</DialogTitle>
          <DialogDescription>
            In <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{prefix || bucket}</code>
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => {
              mutation.mutate(
                { bucket, prefix, name: values.name },
                {
                  onSuccess: (data) => {
                    toast.success("Folder created");
                    onSuccess(data);
                    handleOpenChange(false);
                  },
                  onError: (e) => {
                    if (e instanceof AdminApiError) {
                      if (e.code === "FolderAlreadyExists") {
                        const kind =
                          (e.details as { existingKind?: string } | undefined)
                            ?.existingKind === "file"
                            ? "object"
                            : "folder";
                        form.setError("name", {
                          message: `A ${kind} named "${values.name}" already exists at this location.`,
                        });
                      } else if (e.status === 400) {
                        form.setError("name", { message: e.message });
                      } else {
                        toast.error(e.message); // shipped: setGeneralError(e.message)
                      }
                    } else {
                      toast.error("Network error creating folder"); // shipped: setGeneralError("Network error creating folder")
                    }
                  },
                },
              );
            })}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Folder name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      autoFocus
                      placeholder="2026-photos"
                      maxLength={255}
                      disabled={mutation.isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Run the tests and confirm they pass**

  Run: `bun run --cwd web test -- src/components/objects/create-folder-dialog.test.tsx`
  Expected: 4 PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/objects/create-folder-dialog.tsx
git commit -m "feat(web): CreateFolderDialog component"
```

---

### Task 11: Wire the dialog and "New folder" button into `bucket-detail.tsx`

**Files:**
- Modify: `web/src/pages/bucket-detail.tsx`

- [ ] **Step 1: Add the import for the dialog and the icon**

  At the top of `web/src/pages/bucket-detail.tsx`, add:

```ts
import { FolderPlus } from "lucide-react";
import { CreateFolderDialog } from "@/components/objects/create-folder-dialog";
```

- [ ] **Step 2: Add component state**

  Inside `BucketDetailPage`, near the existing `useState`/`useRef` declarations:

```ts
const [createFolderOpen, setCreateFolderOpen] = useState(false);
```

- [ ] **Step 3: Replace the `toolbarRight` slot in the `ObjectTable` JSX**

  Find the existing prop:

```tsx
toolbarRight={
  <Button type="button" onClick={() => fileInputRef.current?.click()}>
    Upload
  </Button>
}
```

  Replace with:

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

- [ ] **Step 4: Render the dialog inside the page**

  Just below `<UploadQueueSheet ... />` (before `<ObjectsBreadcrumbs ... />`):

```tsx
<CreateFolderDialog
  open={createFolderOpen}
  onOpenChange={setCreateFolderOpen}
  bucket={bucket}
  prefix={prefix}
  onSuccess={(data) => setSearchParams({ prefix: data.prefix })}
/>
```

- [ ] **Step 5: Typecheck and lint**

  Run: `bun run --cwd web typecheck && bun run --cwd web lint`
  Expected: 0 errors.

- [ ] **Step 6: Run the full frontend test suite**

  Run: `bun run --cwd web test`
  Expected: all PASS, including any pre-existing `bucket-detail.test.tsx` cases (they don't currently assert against the toolbar children other than what was already there; if any case fails because the toolbar layout changed, fix the assertion to find the **Upload** button by accessible name rather than position).

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/bucket-detail.tsx
git commit -m "feat(web): wire CreateFolderDialog into bucket detail page"
```

---

### Task 12: Extend `bucket-detail.test.tsx` to cover the new button

**Files:**
- Modify: `web/src/pages/bucket-detail.test.tsx`

- [ ] **Step 1: Add a focused test that the button is present and opens the dialog**

  At the end of the existing `describe(...)` block (or in a new `describe("New folder", ...)` block in the same file):

```tsx
it("renders a New folder button that opens the create-folder dialog", async () => {
  // Use the existing test scaffolding pattern in this file (router + QueryClientProvider).
  renderBucketDetail({ bucket: "docs", prefix: "" });
  const btn = await screen.findByRole("button", { name: /new folder/i });
  expect(btn).toBeInTheDocument();
  await userEvent.click(btn);
  expect(
    await screen.findByRole("dialog", { name: /create folder/i }),
  ).toBeInTheDocument();
});
```

  If the existing file doesn't have a `renderBucketDetail` helper, copy the pattern used by the existing tests in the same file — do not introduce a new test harness.

- [ ] **Step 2: Run the test**

  Run: `bun run --cwd web test -- src/pages/bucket-detail.test.tsx`
  Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/bucket-detail.test.tsx
git commit -m "test(web): bucket detail renders New folder button and opens dialog"
```

---

### Task 13: Final verification (full suites + manual smoke)

**Files:** none.

- [ ] **Step 1: Run the full backend test suite**

  Run: `bun test`
  Expected: all PASS (181 + N from Phase 1).

- [ ] **Step 2: Run the full frontend test suite**

  Run: `bun run --cwd web test`
  Expected: all PASS.

- [ ] **Step 3: Lint everything touched**

  Run: `bunx @biomejs/biome check --write src/admin/ tests/admin/ && bun run --cwd web lint`
  Expected: 0 errors.

- [ ] **Step 4: Manual smoke**

  In two terminals:
  1. `bun run start` (gateway on 8081)
  2. `bun run --cwd web dev` (Vite on 5173)

  Then:
  - Open `http://localhost:5173/_ui/login`, log in.
  - Navigate to any bucket detail page.
  - Click **New folder**, type `manual-smoke`, submit.
  - Expect: toast "Folder created", URL becomes `?prefix=manual-smoke/`, listing shows the empty folder. (The breadcrumbs reflect the new prefix.)
  - Click **New folder** again, retype `manual-smoke` — expect inline 409 error.
  - Type `bad/name` — expect inline "Slashes are not allowed" without a network request.

- [ ] **Step 5: Commit nothing (no code changes); the plan terminal is here.**

---

## Self-Review

This was a checklist run inline against the spec at write time. Findings:

1. **Spec coverage:** Every section of `2026-05-10-create-folder-design.md` maps to a task —
   - §5 API contract → Tasks 3 & 4
   - §6 Backend implementation plan → Tasks 1, 3, 4
   - §7 Frontend implementation plan → Tasks 6–11
   - §8.1 backend tests (14 cases) → Tasks 2 & 5
   - §8.2 frontend tests → Tasks 7, 9, 12
   - §10 Rollout → no work needed (purely additive)
2. **Placeholder scan:** No "TBD"/"TODO". Every code step has full code; every command has the expected outcome.
3. **Type consistency:** `CreateFolderResult` declared in Task 1 is used unchanged in Tasks 3, 4. `useCreateFolder` exported in Task 8 is consumed unchanged in Task 10. `CreateFolderResponse` in Task 6 matches the field names used in Tasks 8 & 10. `objectsKey(bucket, { prefix, delimiter: "/" })` shape in Task 8 matches the canonical shape in `web/src/lib/query-keys.ts`.

