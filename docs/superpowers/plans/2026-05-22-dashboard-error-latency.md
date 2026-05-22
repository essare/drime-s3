# Dashboard Error State & Latency Coloring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace partial dashboard error UI with a centered blocking state (stats/status/Drime-unreachable) plus Retry, and color Drime latency in the Workspace stat card by threshold.

**Architecture:** Pure `latencyColorClass` helper in `web/src/lib/latency-color.ts`. `DashboardPage` gates on `blocked` predicate and early-returns centered `role="alert"` UI; success path renders `statusHint` as JSX with colored `ms`. No hook or backend changes.

**Tech Stack:** React 19, TanStack Query 5, Vitest, Testing Library, Tailwind 4, lucide-react.

**Spec:** [`docs/superpowers/specs/2026-05-22-dashboard-error-latency-design.md`](../specs/2026-05-22-dashboard-error-latency-design.md).

---

## File structure

| File | Purpose |
|------|---------|
| `web/src/lib/latency-color.ts` *(create)* | `latencyColorClass(ms)` thresholds |
| `web/src/lib/latency-color.test.ts` *(create)* | Unit tests for thresholds |
| `web/src/pages/dashboard.tsx` *(modify)* | Gate, error UI, `statusHint` JSX, `StatCard` hint → `ReactNode` |
| `web/src/pages/dashboard.test.tsx` *(modify)* | Blocking, retry, latency class tests |

## How to run

- Focused tests: `bun run --cwd web test src/pages/dashboard.test.tsx` or `bun run --cwd web test src/lib/latency-color.test.ts`
- All web tests: `bun run --cwd web test`
- Lint: `bun run --cwd web lint`
- Typecheck: `bun run --cwd web typecheck`

**Conventions:** TDD per task; one commit per task; `git add` only files listed in that task.

---

### Task 1: `latencyColorClass` helper

**Files:**
- Create: `web/src/lib/latency-color.ts`
- Create: `web/src/lib/latency-color.test.ts`

- [ ] **Step 1: Write failing unit tests**

```ts
// web/src/lib/latency-color.test.ts
import { describe, expect, it } from "vitest";
import { latencyColorClass } from "./latency-color";

describe("latencyColorClass", () => {
  it("returns green below 500ms", () => {
    expect(latencyColorClass(0)).toBe("text-emerald-500");
    expect(latencyColorClass(499)).toBe("text-emerald-500");
  });

  it("returns amber from 500ms through 1500ms", () => {
    expect(latencyColorClass(500)).toBe("text-amber-500");
    expect(latencyColorClass(1500)).toBe("text-amber-500");
  });

  it("returns red above 1500ms", () => {
    expect(latencyColorClass(1501)).toBe("text-red-500");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `bun run --cwd web test src/lib/latency-color.test.ts`  
Expected: module not found / function not defined

- [ ] **Step 3: Implement helper**

```ts
// web/src/lib/latency-color.ts
export function latencyColorClass(ms: number): string {
  if (ms < 500) return "text-emerald-500";
  if (ms <= 1500) return "text-amber-500";
  return "text-red-500";
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `bun run --cwd web test src/lib/latency-color.test.ts`  
Expected: 3 passed

- [ ] **Step 5: Commit** (only if user requested commits)

```bash
git add web/src/lib/latency-color.ts web/src/lib/latency-color.test.ts
git commit -m "feat(web): add latency color thresholds helper"
```

---

### Task 2: Blocking error state (stats failure)

**Files:**
- Modify: `web/src/pages/dashboard.test.tsx`
- Modify: `web/src/pages/dashboard.tsx`

- [ ] **Step 1: Replace failing stats-error test**

Rename `renders error alert when stats endpoint fails` → `shows centered blocking error when stats endpoint fails`.

```ts
  it("shows centered blocking error when stats endpoint fails", async () => {
    mockFetchByUrl({
      "/_admin/status": () => defaultStatus(),
      "/_admin/stats": () =>
        jsonResponse({ error: { code: "Boom", message: "boom" } }, 500),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("alert", { name: /could not load workspace stats/i }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Could not load stats")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new bucket/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /workspace stats/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
```

Note: the alert needs an accessible name — add `aria-labelledby` on the error container pointing at the title `<h2>` id, or use `aria-label` on the `role="alert"` div matching the title text.

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun run --cwd web test src/pages/dashboard.test.tsx -t "centered blocking"`  
Expected: FAIL (still shows old alert / stats region)

- [ ] **Step 3: Implement blocking UI in `dashboard.tsx`**

Add imports:

```ts
import { Activity, AlertCircle, Database, HardDrive, Package, Plus, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { latencyColorClass } from "@/lib/latency-color";
```

Add helpers above `StatCard`:

```ts
type DashboardErrorCopy = { title: string; description: string };

function dashboardErrorCopy(
  statsQuery: ReturnType<typeof useStatsQuery>,
  statusQuery: ReturnType<typeof useStatusQuery>,
): DashboardErrorCopy {
  if (statusQuery.isError) {
    return {
      title: "Could not reach gateway",
      description:
        statusQuery.error instanceof Error
          ? statusQuery.error.message
          : "Unknown error",
    };
  }
  const status = statusQuery.data;
  if (status && !status.drime.reachable) {
    return {
      title: "Drime API unavailable",
      description: status.drime.error ?? "Drime API is not responding",
    };
  }
  return {
    title: "Could not load workspace stats",
    description:
      statsQuery.error instanceof Error
        ? statsQuery.error.message
        : "Failed to load workspace statistics",
  };
}

function DashboardBlocked({
  copy,
  onRetry,
  retrying,
}: {
  copy: DashboardErrorCopy;
  onRetry: () => void;
  retrying: boolean;
}) {
  const titleId = "dashboard-error-title";
  return (
    <div
      role="alert"
      aria-live="polite"
      aria-labelledby={titleId}
      className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <AlertCircle className="size-10 text-destructive" aria-hidden />
      <div className="space-y-2">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {copy.title}
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">{copy.description}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onRetry}
        disabled={retrying}
        aria-busy={retrying}
      >
        <RotateCw
          className={`size-4 ${retrying ? "animate-spin" : ""}`}
          aria-hidden
        />
        Retry
      </Button>
    </div>
  );
}
```

Change `StatCard` hint prop: `hint?: ReactNode`.

Replace `statusLine` with:

```ts
function statusHint(data: StatusData | undefined): ReactNode {
  if (!data) return "Loading…";
  if (data.drime.reachable) {
    const ms = data.drime.latencyMs;
    if (ms === undefined) return "Drime reachable";
    return (
      <span>
        Drime reachable in{" "}
        <span
          className={`font-medium tabular-nums ${latencyColorClass(ms)}`}
        >
          {ms} ms
        </span>
      </span>
    );
  }
  return (
    <span className="text-destructive">
      {data.drime.error ?? "Drime unreachable"}
    </span>
  );
}
```

Inside `DashboardPage`, after hooks:

```ts
  const blocked =
    statsQuery.isError ||
    statusQuery.isError ||
    (statusQuery.data !== undefined && !statusQuery.data.drime.reachable);

  const retrying = statsQuery.isFetching || statusQuery.isFetching;

  const handleRetry = () => {
    void Promise.all([statsQuery.refetch(), statusQuery.refetch()]);
  };

  if (blocked) {
    return (
      <DashboardBlocked
        copy={dashboardErrorCopy(statsQuery, statusQuery)}
        onRetry={handleRetry}
        retrying={retrying}
      />
    );
  }
```

Remove the old block:

```tsx
      {statsQuery.isError ? (
        <Alert variant="destructive">...</Alert>
      ) : null}
```

Remove unused `Alert`, `AlertDescription`, `AlertTitle` imports if no longer used.

Update Workspace `StatCard`: `hint={statusHint(status)}`.

- [ ] **Step 4: Run test — expect PASS**

Run: `bun run --cwd web test src/pages/dashboard.test.tsx`  
Expected: all tests pass (including happy path)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/dashboard.tsx web/src/pages/dashboard.test.tsx
git commit -m "feat(web): dashboard blocking error state with retry"
```

---

### Task 3: Status failure & Drime unreachable tests

**Files:**
- Modify: `web/src/pages/dashboard.test.tsx`

- [ ] **Step 1: Add status failure test**

```ts
  it("shows blocking error when status endpoint fails", async () => {
    mockFetchByUrl({
      "/_admin/status": () =>
        jsonResponse({ error: { code: "Boom", message: "gateway down" } }, 500),
      "/_admin/stats": () =>
        jsonResponse({
          buckets: 0,
          totalBytes: 0,
          totalObjects: 0,
          perBucket: [],
        }),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("alert", { name: /could not reach gateway/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("gateway down")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /workspace stats/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Add Drime unreachable test**

```ts
  it("shows blocking error when Drime is unreachable", async () => {
    mockFetchByUrl({
      "/_admin/status": () =>
        jsonResponse({
          env: {
            drimeApiKeySet: true,
            drimeApiBaseUrl: "https://drime.example",
            s3KeysSet: true,
            region: "drime",
            webUiPasswordSet: true,
          },
          drime: { reachable: false, latencyMs: 3000, error: "timeout" },
          workspace: { name: "drime_admin", id: null, exists: false },
        }),
      "/_admin/stats": () =>
        jsonResponse({
          buckets: 1,
          totalBytes: 100,
          totalObjects: 1,
          perBucket: [{ name: "a", bytes: 100, objects: 1 }],
        }),
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("alert", { name: /drime api unavailable/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /workspace stats/i })).not.toBeInTheDocument();
  });
```

- [ ] **Step 3: Run tests — expect PASS** (implementation from Task 2 already covers these)

Run: `bun run --cwd web test src/pages/dashboard.test.tsx`  
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/dashboard.test.tsx
git commit -m "test(web): dashboard blocking errors for status and Drime"
```

---

### Task 4: Retry recovery test

**Files:**
- Modify: `web/src/pages/dashboard.test.tsx`

- [ ] **Step 1: Add retry test with mutable mock**

```ts
import userEvent from "@testing-library/user-event";

  it("recovers dashboard after Retry when APIs succeed", async () => {
    const user = userEvent.setup();
    let statsFail = true;

    mockFetchByUrl({
      "/_admin/status": () => defaultStatus(),
      "/_admin/stats": () => {
        if (statsFail) {
          return jsonResponse({ error: { code: "Boom", message: "boom" } }, 500);
        }
        return jsonResponse({
          buckets: 1,
          totalBytes: 100,
          totalObjects: 1,
          perBucket: [{ name: "a", bytes: 100, objects: 1 }],
        });
      },
    });

    const client = createTestQueryClient();
    renderWithProviders(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage />
      </MemoryRouter>,
      client,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    statsFail = false;
    await user.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: /workspace stats/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test — expect PASS**

Run: `bun run --cwd web test src/pages/dashboard.test.tsx -t "recovers dashboard"`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/dashboard.test.tsx
git commit -m "test(web): dashboard retry recovers from stats error"
```

---

### Task 5: Latency color integration tests

**Files:**
- Modify: `web/src/pages/dashboard.test.tsx`

- [ ] **Step 1: Add parametrized latency color test**

```ts
  it.each([
    { ms: 100, expectedClass: "text-emerald-500" },
    { ms: 800, expectedClass: "text-amber-500" },
    { ms: 2000, expectedClass: "text-red-500" },
  ])(
    "colors latency $ms ms with $expectedClass",
    async ({ ms, expectedClass }) => {
      mockFetchByUrl({
        "/_admin/status": () =>
          jsonResponse({
            env: {
              drimeApiKeySet: true,
              drimeApiBaseUrl: "https://drime.example",
              s3KeysSet: true,
              region: "drime",
              webUiPasswordSet: true,
            },
            drime: { reachable: true, latencyMs: ms },
            workspace: { name: "drime_admin", id: 1, exists: true },
          }),
        "/_admin/stats": () =>
          jsonResponse({
            buckets: 0,
            totalBytes: 0,
            totalObjects: 0,
            perBucket: [],
          }),
      });

      const client = createTestQueryClient();
      renderWithProviders(
        <MemoryRouter initialEntries={["/dashboard"]}>
          <DashboardPage />
        </MemoryRouter>,
        client,
      );

      await waitFor(() => {
        expect(screen.getByText(`${ms} ms`)).toHaveClass(expectedClass);
      });
    },
  );
```

- [ ] **Step 2: Update happy-path test assertion** (optional tighten)

Existing test expects `Drime reachable in 87 ms` as flat text. After JSX change, assert:

```ts
    expect(buckets).toHaveTextContent("Drime reachable in");
    expect(screen.getByText("87 ms")).toHaveClass("text-emerald-500");
```

- [ ] **Step 3: Run all dashboard tests**

Run: `bun run --cwd web test src/pages/dashboard.test.tsx`  
Expected: all pass

- [ ] **Step 4: Run full web suite + lint**

Run: `bun run --cwd web test`  
Run: `bun run --cwd web lint`  
Run: `bun run --cwd web typecheck`  
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/dashboard.test.tsx
git commit -m "test(web): dashboard latency color thresholds"
```

---

## Spec self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Blocking on stats/status/unreachable | Task 2–3 |
| Centered UI, sidebar stays | Task 2 |
| Retry both queries | Task 2, 4 |
| No CreateBucketDialog when blocked | Task 2 (early return) |
| Latency thresholds | Task 1, 5 |
| Remove top Alert | Task 2 |
| Tests per §8 | Tasks 2–5 |

No placeholders. Types consistent (`useStatsQuery`/`useStatusQuery` return types used in `dashboardErrorCopy`).

---

## Manual smoke test

1. Start gateway + web dev server.
2. Stop Drime or set invalid `DRIME_API_BASE_URL` → dashboard shows centered **Drime API unavailable** + Retry; no stat cards.
3. Restore Drime → Retry → full dashboard with green/amber/red latency on Workspace card.
