import { type FileEntry, fromFileEntryJson } from "./types";

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
  const nested = root.fileEntry ?? root.file ?? root.entry ?? root.data ?? root;
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : null;
}

export function parseCreatedFileEntry(
  raw: unknown,
  fallback: CreatedEntryFallback,
): FileEntry {
  const candidate = unwrap(raw);
  if (!candidate)
    throw new CreatedEntryError("Created entry is not an object.");
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
