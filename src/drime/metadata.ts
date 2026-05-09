export type MetadataV1 = {
  v: 1;
  md5?: string;
  ct?: string;
  meta?: Record<string, string>;
  tags?: Record<string, string>;
};

/** Result of parsing Drime `description` (spec §7.2). */
export type ReadMetadata =
  | MetadataV1
  | { md5: string }
  | { description: string }
  | Record<string, never>;

export function readMetadata(description: string | null): ReadMetadata {
  if (!description) {
    return {};
  }
  if (description.startsWith("md5:")) {
    return { md5: description.slice(4) };
  }
  try {
    const parsed: unknown = JSON.parse(description);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as { v?: unknown }).v === 1
    ) {
      return parsed as MetadataV1;
    }
  } catch {
    /* fall through */
  }
  return { description };
}

export function mergeMetadata(
  current: null,
  patch: Partial<MetadataV1>,
): MetadataV1;
export function mergeMetadata(
  current: string,
  patch: Partial<MetadataV1>,
): MetadataV1 | { description: string };
export function mergeMetadata(
  current: string | null,
  patch: Partial<MetadataV1>,
): MetadataV1 | { description: string } {
  const cur = readMetadata(current);
  // Free-form UI text (not v1 JSON): never merge into structured metadata (spec §7.3).
  if ("description" in cur && !("v" in cur)) {
    return cur as { description: string };
  }

  const base: MetadataV1 =
    "v" in cur && cur.v === 1
      ? { ...(cur as MetadataV1), v: 1 }
      : { v: 1, ...(cur as { md5?: string }) };

  return { ...base, ...patch, v: 1 };
}

export function serializeMetadata(m: MetadataV1): string {
  const copy: MetadataV1 = { ...m, v: 1 };
  if (copy.meta && Object.keys(copy.meta).length === 0) {
    delete copy.meta;
  }
  if (copy.tags && Object.keys(copy.tags).length === 0) {
    delete copy.tags;
  }
  return JSON.stringify(copy);
}
