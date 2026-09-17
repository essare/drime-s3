/**
 * Minimal in-memory Drime API for integration tests (plan Task 10).
 */

import { createHash } from "node:crypto";

type EntryType = "folder" | "text";

type Entry = {
  id: number;
  name: string;
  type: EntryType;
  parent_id: number | null;
  workspaceId: number;
  file_size: number;
  updated_at: string;
  hash?: string | null;
  description?: string | null;
};

export type CreatedEntryShape =
  | "fileEntry"
  | "file"
  | "entry"
  | "data"
  | "direct";

export type MockPartPutReceipt = {
  partNumber: number;
  status: number;
  bytes: number;
};

export type MockFileEntrySnapshot = {
  id: number;
  name: string;
  file_size: number;
};

export type StartMockDrimeOptions = {
  /** Workspace id used for seeded folders (default `1`). */
  workspaceId?: number;
  /** Folder names created at workspace root (valid Drime `type: "folder"` rows). */
  seedRootFolders?: string[];
  /** Remaining forced 500s for POST `/uploads`, `/s3/multipart/create`, and `/s3/entries`. */
  uploadFailureCount?: number;
  /** Remaining forced 500s for PUT `/file-entries/:id`. */
  metadataFailureCount?: number;
  /** Remaining forced 500s for POST `/file-entries/delete`. */
  deleteFailureCount?: number;
  /** Raw JSON body returned by forced 500s. */
  faultBody?: string;
  /** Wrapper used for created-file JSON. Default matches current `{ fileEntry }`. */
  createdEntryShape?: CreatedEntryShape;
  /**
   * After a live delete, include snapshotted rows in this many subsequent
   * folder-list responses (Drive eventual consistency).
   */
  staleListingsAfterDelete?: number;
  /** Status codes consumed one-for-one by `PUT /mock-multipart-put`. */
  partPutStatuses?: number[];
  /** Remaining deletes that remove the ids then return the production 422 body. */
  deleteInvalidIdsCount?: number;
  /**
   * Remaining folder lists that return 200 with an empty page. Used so
   * coordinator confirmation stays unresolved without DrimeClient 5xx retries.
   */
  emptyListingCount?: number;
  /** Remaining forced 500s for GET `/drive/file-entries`. */
  listFailureCount?: number;
  /** Remaining forced 500s for POST `/s3/multipart/batch-sign-part-urls`. */
  signPartUrlFailureCount?: number;
};

function wrapCreatedEntry(
  row: Record<string, unknown>,
  shape: CreatedEntryShape,
): unknown {
  switch (shape) {
    case "file":
      return { file: row };
    case "entry":
      return { entry: row };
    case "data":
      return { data: row };
    case "direct":
      return row;
    default:
      return { fileEntry: row };
  }
}

const DEFAULT_FAULT_BODY = JSON.stringify({ error: "forced failure" });

/** Exact production body for `POST /file-entries/delete` when ids are already gone. */
const INVALID_ENTRY_IDS_BODY = JSON.stringify({
  message: "The selected entry ids is invalid.",
  errors: { entryIds: ["The selected entry ids is invalid."] },
});

function forcedFailureResponse(body: string): Response {
  return new Response(body, {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rollupFolderBytes(
  entries: Entry[],
  startParentId: number | null,
  delta: number,
): void {
  let parentId = startParentId;
  while (parentId !== null) {
    const folder = entries.find(
      (e) => e.id === parentId && e.type === "folder",
    );
    if (!folder) break;
    folder.file_size = Math.max(0, folder.file_size + delta);
    parentId = folder.parent_id;
  }
}

function entryToJson(e: Entry, origin: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: e.id,
    name: e.name,
    type: e.type,
    parent_id: e.parent_id,
    file_size: e.file_size,
    updated_at: e.updated_at,
    hash: e.hash ?? null,
    mime: e.type === "folder" ? null : "application/octet-stream",
    description: e.description ?? null,
    url: e.type === "text" ? `${origin}/file-entries/${e.id}/download` : null,
  };
  return base;
}

/** Partial GET for integration tests (Range: bytes=…). */
function downloadResponse(
  req: Request,
  bytes: Uint8Array,
  mime = "application/octet-stream",
): Response {
  const total = bytes.length;
  const range = req.headers.get("range");
  if (range === null || !range.startsWith("bytes=")) {
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
      },
    });
  }
  const spec = range.slice("bytes=".length).trim();
  let start = 0;
  let end = total - 1;
  if (spec.startsWith("-")) {
    const suffix = Number.parseInt(spec.slice(1), 10);
    if (!Number.isFinite(suffix) || suffix <= 0) {
      return new Response("Invalid Range", { status: 416 });
    }
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else if (spec.endsWith("-")) {
    start = Number.parseInt(spec.slice(0, -1), 10);
    if (!Number.isFinite(start) || start < 0 || start >= total) {
      return new Response("Invalid Range", { status: 416 });
    }
    end = total - 1;
  } else {
    const dash = spec.indexOf("-");
    if (dash < 0) {
      return new Response("Invalid Range", { status: 416 });
    }
    start = Number.parseInt(spec.slice(0, dash), 10);
    const endPart = spec.slice(dash + 1);
    end = endPart === "" ? total - 1 : Number.parseInt(endPart, 10);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start >= total
    ) {
      return new Response("Invalid Range", { status: 416 });
    }
    end = Math.min(end, total - 1);
  }
  const slice = bytes.subarray(start, end + 1);
  return new Response(Buffer.from(slice), {
    status: 206,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(slice.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
    },
  });
}

export type MockDrimeServer = {
  baseUrl: string;
  stop(): void;
  /** Remaining forced 500s for candidate upload/registration. Mutate between requests. */
  uploadFailureCount: number;
  /** Remaining forced 500s for metadata updates. Mutate between requests. */
  metadataFailureCount: number;
  /** Remaining forced 500s for deletes. Mutate between requests. */
  deleteFailureCount: number;
  /** Raw JSON body returned by the next forced 500s. */
  faultBody: string;
  /** Remaining folder lists that still include snapshotted deleted rows. */
  staleListingsAfterDelete: number;
  /** Remaining `/mock-multipart-put` statuses, consumed front-to-back. */
  partPutStatuses: number[];
  /** Remaining deletes that apply then return the production invalid-ids 422. */
  deleteInvalidIdsCount: number;
  /** Remaining folder lists that return an empty 200 page. */
  emptyListingCount: number;
  /** Remaining forced 500s for folder lists. */
  listFailureCount: number;
  /** Remaining forced 500s for batch-sign-part-urls. */
  signPartUrlFailureCount: number;
  /** Every `PUT /mock-multipart-put`, including failed statuses. */
  partPutReceipts: MockPartPutReceipt[];
  /** `POST /s3/multipart/complete` invocations, including 4xx. */
  multipartCompleteCount: number;
  /** Live Drive file rows (not folders, not stale snapshots). */
  snapshotFileEntries(): MockFileEntrySnapshot[];
  /** Clone a live file row under the same parent and exact name. */
  cloneFileById(id: number): number | undefined;
};

/**
 * Starts `Bun.serve` on an ephemeral port with canned Drime routes used by `DrimeClient`.
 */
export async function startMockDrime(
  options: StartMockDrimeOptions = {},
): Promise<MockDrimeServer> {
  const workspaceId = options.workspaceId ?? 1;
  const workspaces = [{ id: workspaceId, name: "drime-s3" }];
  let nextId = 100;
  const entries: Entry[] = [];
  const fileBytes = new Map<number, Uint8Array>();

  type MultipartState = {
    drimeKey: string;
    parts: Map<number, Uint8Array>;
  };
  const multipartByUploadId = new Map<string, MultipartState>();
  const mergedByDrimeKey = new Map<string, Uint8Array>();

  for (const name of options.seedRootFolders ?? []) {
    entries.push({
      id: nextId++,
      name,
      type: "folder",
      parent_id: null,
      workspaceId,
      file_size: 0,
      updated_at: "2024-01-01T00:00:00.000Z",
    });
  }

  const createdEntryShape: CreatedEntryShape =
    options.createdEntryShape ?? "fileEntry";
  const staleDeleted: Entry[] = [];
  const handle: MockDrimeServer = {
    baseUrl: "",
    stop() {},
    uploadFailureCount: options.uploadFailureCount ?? 0,
    metadataFailureCount: options.metadataFailureCount ?? 0,
    deleteFailureCount: options.deleteFailureCount ?? 0,
    faultBody: options.faultBody ?? DEFAULT_FAULT_BODY,
    staleListingsAfterDelete: options.staleListingsAfterDelete ?? 0,
    partPutStatuses: [...(options.partPutStatuses ?? [])],
    deleteInvalidIdsCount: options.deleteInvalidIdsCount ?? 0,
    emptyListingCount: options.emptyListingCount ?? 0,
    listFailureCount: options.listFailureCount ?? 0,
    signPartUrlFailureCount: options.signPartUrlFailureCount ?? 0,
    partPutReceipts: [],
    multipartCompleteCount: 0,
    snapshotFileEntries() {
      return entries
        .filter((e) => e.type === "text")
        .map((e) => ({ id: e.id, name: e.name, file_size: e.file_size }));
    },
    cloneFileById(id: number) {
      const row = entries.find((e) => e.id === id && e.type === "text");
      if (!row) return undefined;
      const bytes = fileBytes.get(id);
      if (!bytes) return undefined;
      const cloneId = nextId++;
      const clone: Entry = { ...row, id: cloneId };
      entries.push(clone);
      fileBytes.set(cloneId, new Uint8Array(bytes));
      rollupFolderBytes(entries, clone.parent_id, clone.file_size);
      return cloneId;
    },
  };

  const applyDeletes = (ids: Set<number>): void => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const row = entries[i];
      if (row !== undefined && ids.has(row.id)) {
        staleDeleted.push({ ...row });
        if (row.type === "text") {
          rollupFolderBytes(entries, row.parent_id, -row.file_size);
        }
        fileBytes.delete(row.id);
        entries.splice(i, 1);
      }
    }
  };

  const takeFault = (
    key:
      | "uploadFailureCount"
      | "metadataFailureCount"
      | "deleteFailureCount"
      | "listFailureCount"
      | "signPartUrlFailureCount",
  ): boolean => {
    if (handle[key] > 0) {
      handle[key] -= 1;
      return true;
    }
    return false;
  };

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      const putPartMatch = /^\/mock-multipart-put\/([^/]+)\/(\d+)$/.exec(path);
      if (req.method === "PUT" && putPartMatch) {
        return (async () => {
          const uploadId = putPartMatch[1] ?? "";
          const partNum = Number(putPartMatch[2]);
          const state = multipartByUploadId.get(uploadId);
          if (!state || !Number.isFinite(partNum)) {
            return new Response("Not Found", { status: 404 });
          }
          const buf = new Uint8Array(await req.arrayBuffer());
          const queued = handle.partPutStatuses.shift();
          const status =
            typeof queued === "number" && Number.isFinite(queued)
              ? queued
              : 200;
          handle.partPutReceipts.push({
            partNumber: partNum,
            status,
            bytes: buf.byteLength,
          });
          if (status < 200 || status >= 300) {
            return new Response("part put failed", { status });
          }
          state.parts.set(partNum, buf);
          const md5 = createHash("md5").update(buf).digest("hex");
          return new Response("", {
            status,
            headers: { ETag: `"${md5}"` },
          });
        })();
      }

      if (req.method === "GET" && path === "/me/workspaces") {
        return json(workspaces);
      }

      if (req.method === "POST" && path === "/workspace") {
        const id = nextId++;
        workspaces.push({ id, name: `ws-${id}` });
        return json({ workspace: { id, name: `ws-${id}`, type: "workspace" } });
      }

      if (req.method === "GET" && path === "/drive/file-entries") {
        if (takeFault("listFailureCount")) {
          return forcedFailureResponse(handle.faultBody);
        }
        if (handle.emptyListingCount > 0) {
          handle.emptyListingCount -= 1;
          return json({ data: [], last_page: 1 });
        }
        const ws = Number(url.searchParams.get("workspaceId") ?? "0");
        const parentIdsRaw = url.searchParams.get("parentIds");
        const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
        const perPage = Math.max(
          1,
          Number(url.searchParams.get("perPage") ?? "100"),
        );

        const matchesParent = (e: Entry): boolean => {
          if (e.workspaceId !== ws) return false;
          if (parentIdsRaw === null || parentIdsRaw === "") {
            return e.parent_id === null;
          }
          return e.parent_id === Number(parentIdsRaw);
        };

        let rows = entries.filter(matchesParent);
        if (handle.staleListingsAfterDelete > 0 && staleDeleted.length > 0) {
          const liveIds = new Set(rows.map((e) => e.id));
          const extra = staleDeleted.filter(
            (e) => matchesParent(e) && !liveIds.has(e.id),
          );
          rows = [...extra, ...rows];
          handle.staleListingsAfterDelete -= 1;
        }

        const total = rows.length;
        const lastPage = Math.max(1, Math.ceil(total / perPage));
        const start = (page - 1) * perPage;
        const data = rows
          .slice(start, start + perPage)
          .map((e) => entryToJson(e, url.origin));
        return json({ data, last_page: lastPage });
      }

      if (req.method === "POST" && path === "/folders") {
        return (async () => {
          const body = (await req.json()) as {
            name?: string;
            workspaceId?: number;
            parentId?: number;
          };
          const name = typeof body.name === "string" ? body.name : "folder";
          const ws =
            typeof body.workspaceId === "number"
              ? body.workspaceId
              : workspaceId;
          const parentId =
            typeof body.parentId === "number" && Number.isFinite(body.parentId)
              ? body.parentId
              : null;
          const id = nextId++;
          const row: Entry = {
            id,
            name,
            type: "folder",
            parent_id: parentId,
            workspaceId: ws,
            file_size: 0,
            updated_at: "2024-06-01T12:00:00.000Z",
          };
          entries.push(row);
          return json({
            folder: {
              id: row.id,
              name: row.name,
              type: "folder",
              parent_id: row.parent_id,
              workspaceId: row.workspaceId,
            },
          });
        })();
      }

      if (req.method === "POST" && path === "/uploads") {
        return (async () => {
          if (takeFault("uploadFailureCount")) {
            return forcedFailureResponse(handle.faultBody);
          }
          const ct = req.headers.get("content-type") ?? "";
          let parentId: number | null = null;
          let ws = workspaceId;
          let relativePath = "uploaded";
          let payload = new Uint8Array(0);
          if (ct.includes("multipart/form-data")) {
            const fd = await req.formData();
            const pid = fd.get("parentId");
            if (typeof pid === "string" && /^\d+$/.test(pid)) {
              parentId = Number(pid);
            }
            const wid = fd.get("workspaceId");
            if (typeof wid === "string" && /^\d+$/.test(wid)) {
              ws = Number(wid);
            }
            const rp = fd.get("relativePath");
            if (typeof rp === "string" && rp.length > 0) {
              relativePath = rp;
            }
            const fileField = fd.get("file");
            if (fileField instanceof Blob) {
              payload = new Uint8Array(await fileField.arrayBuffer());
            }
          }
          const id = nextId++;
          const name = relativePath.includes("/")
            ? (relativePath.split("/").pop() ?? "file")
            : relativePath;
          const row: Entry = {
            id,
            name,
            type: "text",
            parent_id: parentId,
            workspaceId: ws,
            file_size: payload.length,
            updated_at: "2024-07-01T10:00:00.000Z",
          };
          entries.push(row);
          fileBytes.set(id, payload);
          rollupFolderBytes(entries, parentId, payload.length);
          return json(
            wrapCreatedEntry(entryToJson(row, url.origin), createdEntryShape),
          );
        })();
      }

      const downloadMatch = /^\/file-entries\/(\d+)\/download$/.exec(path);
      if (req.method === "GET" && downloadMatch) {
        const id = Number(downloadMatch[1]);
        const bytes = fileBytes.get(id);
        if (bytes === undefined) {
          return new Response("Not Found", { status: 404 });
        }
        return downloadResponse(req, bytes);
      }

      const entryPutMatch = /^\/file-entries\/(\d+)$/.exec(path);
      if (req.method === "PUT" && entryPutMatch) {
        return (async () => {
          if (takeFault("metadataFailureCount")) {
            return forcedFailureResponse(handle.faultBody);
          }
          const id = Number(entryPutMatch[1]);
          const row = entries.find((e) => e.id === id);
          if (row === undefined) {
            return new Response("Not Found", { status: 404 });
          }
          const body = (await req.json()) as { description?: string };
          if (typeof body.description === "string") {
            row.description = body.description;
          }
          return json({ fileEntry: entryToJson(row, url.origin) });
        })();
      }

      if (req.method === "POST" && path === "/file-entries/delete") {
        return (async () => {
          const body = (await req.json()) as { entryIds?: number[] };
          const ids = new Set(body.entryIds ?? []);
          if (handle.deleteInvalidIdsCount > 0) {
            handle.deleteInvalidIdsCount -= 1;
            applyDeletes(ids);
            return new Response(INVALID_ENTRY_IDS_BODY, {
              status: 422,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (takeFault("deleteFailureCount")) {
            return forcedFailureResponse(handle.faultBody);
          }
          applyDeletes(ids);
          return json({ status: "success" });
        })();
      }

      if (req.method === "POST" && path === "/s3/multipart/create") {
        return (async () => {
          if (takeFault("uploadFailureCount")) {
            return forcedFailureResponse(handle.faultBody);
          }
          await req.arrayBuffer().catch(() => undefined);
          const uid = `mu-${nextId++}`;
          const dk = `dk-${uid}`;
          multipartByUploadId.set(uid, { drimeKey: dk, parts: new Map() });
          return json({ uploadId: uid, key: dk });
        })();
      }

      if (
        req.method === "POST" &&
        path === "/s3/multipart/batch-sign-part-urls"
      ) {
        return (async () => {
          if (takeFault("signPartUrlFailureCount")) {
            return forcedFailureResponse(handle.faultBody);
          }
          const body = (await req.json()) as {
            uploadId?: string;
            partNumbers?: number[];
          };
          const uploadId = body.uploadId;
          const nums = body.partNumbers ?? [1];
          if (typeof uploadId !== "string") {
            return json({ error: "missing uploadId" }, 400);
          }
          const urls = nums.map((pn) => ({
            url: `${url.origin}/mock-multipart-put/${uploadId}/${pn}`,
            partNumber: pn,
          }));
          return json({ urls });
        })();
      }

      if (req.method === "POST" && path === "/s3/multipart/complete") {
        return (async () => {
          handle.multipartCompleteCount += 1;
          const body = (await req.json()) as {
            key?: string;
            uploadId?: string;
            parts?: { PartNumber?: number; partNumber?: number }[];
          };
          const uid = body.uploadId;
          const dk = body.key;
          if (typeof uid !== "string" || typeof dk !== "string") {
            return json({ error: "bad request" }, 400);
          }
          const state = multipartByUploadId.get(uid);
          if (!state) {
            return json({ error: "unknown upload" }, 400);
          }
          const partList = body.parts ?? [];
          const buffers: Uint8Array[] = [];
          for (const p of partList) {
            const n =
              typeof p.PartNumber === "number"
                ? p.PartNumber
                : typeof p.partNumber === "number"
                  ? p.partNumber
                  : NaN;
            if (!Number.isFinite(n)) continue;
            const b = state.parts.get(n);
            if (b) buffers.push(b);
          }
          const merged =
            buffers.length === 0
              ? new Uint8Array(0)
              : new Uint8Array(
                  Buffer.concat(buffers.map((x) => Buffer.from(x))),
                );
          mergedByDrimeKey.set(dk, merged);
          multipartByUploadId.delete(uid);
          return json({ status: "complete" });
        })();
      }

      if (req.method === "POST" && path === "/s3/multipart/abort") {
        return (async () => {
          const body = (await req.json()) as { uploadId?: string };
          if (typeof body.uploadId === "string") {
            multipartByUploadId.delete(body.uploadId);
          }
          return json({ status: "aborted" });
        })();
      }

      if (req.method === "POST" && path === "/s3/entries") {
        return (async () => {
          if (takeFault("uploadFailureCount")) {
            return forcedFailureResponse(handle.faultBody);
          }
          const body = (await req.json()) as {
            filename?: string;
            clientName?: string;
            relativePath?: string;
            workspaceId?: number;
            parentId?: number;
          };
          const fn = typeof body.filename === "string" ? body.filename : "";
          let bytes = mergedByDrimeKey.get(fn);
          if (bytes === undefined) {
            for (const [k, v] of mergedByDrimeKey) {
              if (k.endsWith(`/${fn}`) || k === fn) {
                bytes = v;
                mergedByDrimeKey.delete(k);
                break;
              }
            }
          } else {
            mergedByDrimeKey.delete(fn);
          }
          if (bytes === undefined) {
            return json({ error: "no merged multipart payload" }, 400);
          }
          const name =
            typeof body.clientName === "string" && body.clientName.length > 0
              ? body.clientName
              : (body.relativePath?.split("/").pop() ?? fn);
          const id = nextId++;
          const ws =
            typeof body.workspaceId === "number"
              ? body.workspaceId
              : workspaceId;
          const parentId =
            typeof body.parentId === "number" && Number.isFinite(body.parentId)
              ? body.parentId
              : null;
          const row: Entry = {
            id,
            name,
            type: "text",
            parent_id: parentId,
            workspaceId: ws,
            file_size: bytes.length,
            updated_at: "2025-01-02T00:00:00.000Z",
          };
          entries.push(row);
          fileBytes.set(id, bytes);
          return json(
            wrapCreatedEntry(entryToJson(row, url.origin), createdEntryShape),
          );
        })();
      }

      return new Response("not found", { status: 404 });
    },
  });

  handle.baseUrl = `http://127.0.0.1:${server.port}`;
  handle.stop = () => {
    server.stop();
  };
  return handle;
}
