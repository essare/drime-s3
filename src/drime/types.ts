/** Drime drive file entry — mirrors `python-port/drime_s3/models.py` for gateway use. */

export interface FileEntry {
  id: number;
  name: string;
  parent_id: number | null;
  is_folder: boolean;
  file_size: number;
  hash: string | null;
  mime: string | null;
  updated_at: string | null;
  created_at: string | null;
  description: string | null;
  url: string | null;
}

function finiteNumber(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function optionalString(v: unknown): string | null {
  if (typeof v === "string") return v;
  return null;
}

function optionalParentId(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v === null) return null;
  return null;
}

/**
 * Parse a Drime API JSON object into `FileEntry`.
 * Unknown or non-object input yields a safe empty entry (id 0, empty name).
 */
export function fromFileEntryJson(item: unknown): FileEntry {
  if (item === null || typeof item !== "object") {
    return {
      id: 0,
      name: "",
      parent_id: null,
      is_folder: false,
      file_size: 0,
      hash: null,
      mime: null,
      updated_at: null,
      created_at: null,
      description: null,
      url: null,
    };
  }

  const o = item as Record<string, unknown>;
  const type = o.type;

  return {
    id: finiteNumber(o.id, 0),
    name: typeof o.name === "string" ? o.name : "",
    parent_id: optionalParentId(o.parent_id),
    is_folder: type === "folder",
    file_size: finiteNumber(o.file_size, 0),
    hash: optionalString(o.hash),
    mime: optionalString(o.mime),
    updated_at: optionalString(o.updated_at) ?? optionalString(o.updatedAt),
    created_at: optionalString(o.created_at) ?? optionalString(o.createdAt),
    description: optionalString(o.description),
    url: optionalString(o.url),
  };
}
