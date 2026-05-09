import { type FileEntry, fromFileEntryJson } from "./types";
import type { WorkspaceRow } from "./workspace";
import {
  findWorkspaceIdByName,
  parseWorkspaceCreate,
  parseWorkspaceList,
} from "./workspace";

export type { WorkspaceRow } from "./workspace";

export class GatewayWorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayWorkspaceError";
  }
}

export class DrimeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Drime API error ${status}`);
    this.name = "DrimeApiError";
  }
}

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
const PER_PAGE = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function isNoRetryUpload(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && path.endsWith("/uploads");
}

/** Compatible with `typeof fetch` / `globalThis.fetch` for injection in tests. */
export type DrimeFetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class DrimeClient {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly fetchFn: DrimeFetchFn;

  constructor(opts: {
    apiKey: string;
    apiBaseUrl: string;
    /** Defaults to `globalThis.fetch`; accepts `typeof fetch`. */
    fetchFn?: DrimeFetchFn;
  }) {
    this.apiKey = opts.apiKey;
    this.apiBaseUrl = opts.apiBaseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Authenticated Drime API request with retries (§11.2): 5 attempts, backoff `500ms × (attempt+1)` between tries.
   * Does not retry `POST /uploads`.
   */
  async request(
    method: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    const url = joinUrl(this.apiBaseUrl, path);
    const noRetry = isNoRetryUpload(method, path);
    const maxAttempts = noRetry ? 1 : MAX_ATTEMPTS;

    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);

    const { method: _ignored, ...restInit } = init ?? {};
    let lastNetworkError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          ...restInit,
          method,
          headers,
        });

        if (res.ok) {
          return res;
        }

        const bodyText = await res.text();
        const shouldRetry =
          !noRetry &&
          RETRY_STATUSES.has(res.status) &&
          attempt < maxAttempts - 1;

        if (shouldRetry) {
          await sleep(500 * (attempt + 1));
          continue;
        }

        throw new DrimeApiError(res.status, bodyText);
      } catch (e) {
        if (e instanceof DrimeApiError) {
          throw e;
        }
        lastNetworkError = e;
        const shouldRetry = !noRetry && attempt < maxAttempts - 1;
        if (shouldRetry) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }

    throw lastNetworkError instanceof Error
      ? lastNetworkError
      : new Error(String(lastNetworkError));
  }

  async listFolder(
    parentId: number | null,
    workspaceId = 0,
  ): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        workspaceId: String(workspaceId),
        perPage: String(PER_PAGE),
        page: String(page),
      });
      if (parentId !== null) {
        params.set("parentIds", String(parentId));
      }

      const res = await this.request(
        "GET",
        `/drive/file-entries?${params.toString()}`,
      );
      const payload = (await res.json()) as {
        data?: unknown[];
        last_page?: number;
      };

      const items = payload.data ?? [];
      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        entries.push(fromFileEntryJson(item));
      }

      const lastPage = payload.last_page ?? 1;
      if (page >= lastPage) {
        break;
      }
      page += 1;
    }

    return entries;
  }

  async createFolder(
    name: string,
    opts?: { parentId?: number; workspaceId?: number },
  ): Promise<unknown> {
    const workspaceId = opts?.workspaceId ?? 0;
    const body: Record<string, unknown> = { name, workspaceId };
    if (opts?.parentId !== undefined) {
      body.parentId = opts.parentId;
    }

    const res = await this.request("POST", "/folders", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async uploadFile(params: {
    filePath: string;
    relativePath: string;
    parentId?: number;
    /** Drime workspace for uploads (gateway workspace id `W`). Defaults to `0` for legacy/tests. */
    workspaceId?: number;
  }): Promise<unknown> {
    const workspaceId = params.workspaceId ?? 0;
    const form = new FormData();
    const rp = params.relativePath.replace(/^\/+/, "");
    const multipartFileName = rp.includes("/")
      ? (rp.split("/").pop() ?? "file")
      : rp || "file";
    form.append("file", Bun.file(params.filePath), multipartFileName);
    form.append("relativePath", params.relativePath);
    form.append("workspaceId", String(workspaceId));
    if (params.parentId !== undefined) {
      form.append("parentId", String(params.parentId));
    }

    const res = await this.request("POST", "/uploads", { body: form });
    return res.json();
  }

  getDownloadUrl(entryId: number): string {
    return joinUrl(this.apiBaseUrl, `/file-entries/${entryId}/download`);
  }

  /**
   * Optional metadata update (e.g. `description: "md5:…"` for S3 ETag parity) when Drime supports `PUT /file-entries/:id`.
   */
  async updateFileEntryDescription(
    entryId: number,
    description: string,
  ): Promise<void> {
    await this.request("PUT", `/file-entries/${entryId}`, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
  }

  /** Authenticated `fetch` to an absolute URL (e.g. file download). */
  async fetchAuthenticated(
    absoluteUrl: string,
    init?: RequestInit,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    return this.fetchFn(absoluteUrl, { ...init, headers });
  }

  async deleteEntriesForever(ids: number[]): Promise<unknown> {
    const res = await this.request("POST", "/file-entries/delete", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryIds: ids, deleteForever: true }),
    });
    return res.json();
  }

  /** `GET /me/workspaces` — bearer token same as other Drime calls. */
  async listWorkspaces(): Promise<WorkspaceRow[]> {
    const res = await this.request("GET", "/me/workspaces");
    const json: unknown = await res.json();
    return parseWorkspaceList(json);
  }

  /** `POST /workspace` with `{"name":"..."}`. Returns new workspace id. */
  async createWorkspace(name: string): Promise<number> {
    const res = await this.request("POST", "/workspace", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json: unknown = await res.json();
    return parseWorkspaceCreate(json);
  }

  /**
   * Idempotent bootstrap for `drime-s3 init`: create the named workspace if absent.
   */
  async ensureGatewayWorkspace(name: string): Promise<number> {
    const rows = await this.listWorkspaces();
    const existing = findWorkspaceIdByName(rows, name);
    if (existing !== undefined) return existing;
    return this.createWorkspace(name);
  }

  /**
   * Resolve workspace id for `serve`. Does **not** create — throws `GatewayWorkspaceError` if missing
   * (caller should instruct user to run `drime-s3 init`).
   */
  async resolveGatewayWorkspaceId(opts: {
    name: string;
    pinnedId?: number;
  }): Promise<number> {
    if (opts.pinnedId !== undefined && Number.isFinite(opts.pinnedId)) {
      return opts.pinnedId;
    }
    const rows = await this.listWorkspaces();
    const id = findWorkspaceIdByName(rows, opts.name);
    if (id === undefined) {
      throw new GatewayWorkspaceError(
        `Drime workspace "${opts.name}" not found. Run: drime-s3 init`,
      );
    }
    return id;
  }
}
