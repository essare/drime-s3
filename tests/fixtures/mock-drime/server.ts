/**
 * Minimal in-memory Drime API for integration tests (plan Task 10).
 */

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

export type StartMockDrimeOptions = {
  /** Workspace id used for seeded folders (default `1`). */
  workspaceId?: number;
  /** Folder names created at workspace root (valid Drime `type: "folder"` rows). */
  seedRootFolders?: string[];
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "PUT" && path === "/mock-part") {
        return new Response("", {
          status: 200,
          headers: { ETag: '"mock-part-etag"' },
        });
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
        const ws = Number(url.searchParams.get("workspaceId") ?? "0");
        const parentIdsRaw = url.searchParams.get("parentIds");
        const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
        const perPage = Math.max(
          1,
          Number(url.searchParams.get("perPage") ?? "100"),
        );

        let rows = entries.filter((e) => e.workspaceId === ws);
        if (parentIdsRaw === null || parentIdsRaw === "") {
          rows = rows.filter((e) => e.parent_id === null);
        } else {
          const pid = Number(parentIdsRaw);
          rows = rows.filter((e) => e.parent_id === pid);
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
          return json({ fileEntry: entryToJson(row, url.origin) });
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
          for (let i = entries.length - 1; i >= 0; i--) {
            const row = entries[i];
            if (row !== undefined && ids.has(row.id)) {
              fileBytes.delete(row.id);
              entries.splice(i, 1);
            }
          }
          return json({ status: "success" });
        })();
      }

      if (req.method === "POST" && path === "/s3/multipart/create") {
        return json({ uploadId: "drime-mock-upload", key: "mock-key" });
      }

      if (
        req.method === "POST" &&
        path === "/s3/multipart/batch-sign-part-urls"
      ) {
        const partUrl = `${url.origin}/mock-part`;
        return json({ urls: [{ url: partUrl, partNumber: 1 }] });
      }

      if (req.method === "POST" && path === "/s3/multipart/complete") {
        return json({ status: "complete" });
      }

      if (req.method === "POST" && path === "/s3/multipart/abort") {
        return json({ status: "aborted" });
      }

      return new Response("not found", { status: 404 });
    },
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;

  return {
    baseUrl,
    stop() {
      server.stop();
    },
  };
}
