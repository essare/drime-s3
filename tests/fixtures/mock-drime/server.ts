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

function entryToJson(e: Entry): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    parent_id: e.parent_id,
    file_size: e.file_size,
    updated_at: e.updated_at,
    hash: null,
    mime: e.type === "folder" ? null : "application/octet-stream",
    description: null,
    url: null,
  };
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
        const data = rows.slice(start, start + perPage).map(entryToJson);
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
            file_size: 1,
            updated_at: "2024-07-01T10:00:00.000Z",
          };
          entries.push(row);
          return json({ fileEntry: entryToJson(row) });
        })();
      }

      if (req.method === "POST" && path === "/file-entries/delete") {
        return (async () => {
          const body = (await req.json()) as { entryIds?: number[] };
          const ids = new Set(body.entryIds ?? []);
          for (let i = entries.length - 1; i >= 0; i--) {
            const row = entries[i];
            if (row !== undefined && ids.has(row.id)) {
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
