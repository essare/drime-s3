/** Normalizes path keys: leading slash stripped, no trailing slash, lowercased (Drime folders are matched case-insensitively). */
export function normalizePathKey(path: string): string {
  const p = path.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (p.length === 0) return "";
  return p.toLowerCase();
}

/**
 * Maps logical folder paths (within the gateway workspace) to Drime folder ids.
 * Keys are lowercased path strings (see spec §10.1).
 */
export class FolderPathCache {
  private readonly map = new Map<string, number>();

  get(path: string): number | undefined {
    return this.map.get(normalizePathKey(path));
  }

  set(path: string, folderId: number): void {
    this.map.set(normalizePathKey(path), folderId);
  }

  delete(path: string): void {
    this.map.delete(normalizePathKey(path));
  }

  /**
   * Remove every cached path whose normalized key starts with `prefixNorm` (inclusive of exact prefix).
   * Pass prefix like `my-bucket` or `my-bucket/sub` (slashes optional; normalized internally).
   */
  evictPrefix(prefix: string): void {
    const p = normalizePathKey(prefix);
    if (p.length === 0) {
      this.map.clear();
      return;
    }
    const keys = [...this.map.keys()].filter(
      (k) => k === p || k.startsWith(`${p}/`),
    );
    for (const k of keys) {
      this.map.delete(k);
    }
  }

  /** For health / debugging */
  get size(): number {
    return this.map.size;
  }
}
