import type {
  WorkspaceObjectCounts,
  WorkspaceStats,
} from "../admin/stats-types";

const DEFAULT_TTL_MS = 60_000;

/**
 * Short-TTL cache for workspace stats so repeat dashboard loads avoid
 * re-listing Drime on every navigation.
 */
export class StatsCache {
  private entry: { ts: number; stats: WorkspaceStats } | null = null;

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  get(): WorkspaceStats | null {
    const hit = this.entry;
    if (!hit) return null;
    if (Date.now() - hit.ts >= this.ttlMs) return null;
    return hit.stats;
  }

  set(stats: WorkspaceStats): void {
    this.entry = { ts: Date.now(), stats };
  }

  invalidate(): void {
    this.entry = null;
  }
}

/** Cache for slow tree-walk object counts (separate from fast `/stats`). */
export class ObjectCountsCache {
  private entry: { ts: number; counts: WorkspaceObjectCounts } | null = null;

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  get(): WorkspaceObjectCounts | null {
    const hit = this.entry;
    if (!hit) return null;
    if (Date.now() - hit.ts >= this.ttlMs) return null;
    return hit.counts;
  }

  set(counts: WorkspaceObjectCounts): void {
    this.entry = { ts: Date.now(), counts };
  }

  invalidate(): void {
    this.entry = null;
  }
}
