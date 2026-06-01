import type { WorkspaceStats } from "../admin/stats-types";

const DEFAULT_TTL_MS = 60_000;

type Cached = { ts: number; stats: WorkspaceStats; accurate: boolean };

/**
 * Short-TTL cache for workspace stats so repeat dashboard loads avoid
 * re-listing Drime on every navigation.
 */
export class StatsCache {
  private entry: Cached | null = null;

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  get(accurate: boolean): WorkspaceStats | null {
    const hit = this.entry;
    if (!hit) return null;
    if (hit.accurate !== accurate) return null;
    if (Date.now() - hit.ts >= this.ttlMs) return null;
    return hit.stats;
  }

  set(stats: WorkspaceStats, accurate: boolean): void {
    this.entry = { ts: Date.now(), stats, accurate };
  }

  invalidate(): void {
    this.entry = null;
  }
}
