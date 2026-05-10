import { toast } from "sonner";

export type DropEnqueueArg = {
  file: File;
  relativePath?: string;
};

const MAX_FOLDER_FILES = 1000;
const MAX_DIRECTORY_DEPTH = 40;

function readEntriesAll(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const acc: FileSystemEntry[] = [];
    const readBatch = () => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) resolve(acc);
          else {
            acc.push(...entries);
            readBatch();
          }
        },
        (err) => reject(err),
      );
    };
    readBatch();
  });
}

async function walkEntry(
  entry: FileSystemEntry,
  parentRel: string,
  depth: number,
  out: DropEnqueueArg[],
): Promise<void> {
  if (out.length >= MAX_FOLDER_FILES) return;
  if (depth > MAX_DIRECTORY_DEPTH) {
    toast.warning("Folder upload depth limit reached; some files were skipped");
    return;
  }

  if (entry.isFile) {
    const fe = entry as FileSystemFileEntry;
    const file = await new Promise<File>((res, rej) => fe.file(res, rej));
    const rel = parentRel ? `${parentRel}/${file.name}` : file.name;
    out.push({
      file,
      relativePath: rel.replace(/^\/+/, ""),
    });
    return;
  }

  if (entry.isDirectory) {
    const de = entry as FileSystemDirectoryEntry;
    const dirName = entry.name;
    const base = parentRel ? `${parentRel}/${dirName}` : dirName;
    const reader = de.createReader();
    const children = await readEntriesAll(reader);
    for (const child of children) {
      await walkEntry(child, base, depth + 1, out);
      if (out.length >= MAX_FOLDER_FILES) return;
    }
  }
}

type ItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

/**
 * Best-effort extraction of files from a drop event (flat files + folder trees via webkitGetAsEntry).
 */
export async function collectDropEnqueueArgs(
  dt: DataTransfer,
): Promise<DropEnqueueArg[]> {
  const items = dt.items;
  if (!items?.length) return [];

  const first = items[0] as ItemWithEntry;
  if (typeof first.webkitGetAsEntry === "function") {
    const out: DropEnqueueArg[] = [];
    let onlyDirectoryRoots = true;

    for (let i = 0; i < items.length; i++) {
      const it = items[i] as ItemWithEntry;
      const entry = it.webkitGetAsEntry?.() ?? null;
      if (!entry) {
        onlyDirectoryRoots = false;
        continue;
      }
      if (entry.isFile) onlyDirectoryRoots = false;
      await walkEntry(entry, "", 0, out);
      if (out.length >= MAX_FOLDER_FILES) break;
    }

    if (out.length >= MAX_FOLDER_FILES) {
      toast.warning(
        `Folder upload limited to ${MAX_FOLDER_FILES} files; extra entries were skipped`,
      );
    }

    if (out.length > 0) return out;

    if (onlyDirectoryRoots && items.length > 0) {
      toast.error("Folder upload not supported in v1; drop files instead");
      return [];
    }
  }

  const flat: DropEnqueueArg[] = [];
  for (let i = 0; i < items.length; i++) {
    const f = items[i].getAsFile();
    if (f) flat.push({ file: f });
  }
  return flat;
}
