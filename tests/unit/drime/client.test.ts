import { describe, expect, test } from "bun:test";
import {
  DrimeApiError,
  DrimeClient,
  type DrimeFetchFn,
  GatewayWorkspaceError,
  isInvalidEntryIdsError,
} from "../../../src/drime/client";

describe("DrimeClient", () => {
  test("listFolder retries on 503 then succeeds", async () => {
    let calls = 0;
    const fetchFn: DrimeFetchFn = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("Service Unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ data: [], last_page: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new DrimeClient({
      apiKey: "test-key",
      apiBaseUrl: "https://app.drime.cloud/api/v1",
      fetchFn,
    });

    const result = await client.listFolder(null);
    expect(calls).toBe(2);
    expect(result).toEqual([]);
  });

  test("resolveGatewayWorkspaceId returns pinned id without listing", async () => {
    const fetchFn: DrimeFetchFn = async () => {
      throw new Error("fetch should not run when workspace id is pinned");
    };
    const client = new DrimeClient({
      apiKey: "k",
      apiBaseUrl: "https://app.drime.cloud/api/v1",
      fetchFn,
    });
    await expect(
      client.resolveGatewayWorkspaceId({ name: "drime-s3", pinnedId: 99 }),
    ).resolves.toBe(99);
  });

  test("ensureGatewayWorkspace returns existing id", async () => {
    let listCalls = 0;
    const fetchFn: DrimeFetchFn = async (input) => {
      const url = String(input);
      if (url.includes("/me/workspaces")) {
        listCalls += 1;
        return new Response(JSON.stringify([{ id: 5, name: "drime-s3" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    };
    const client = new DrimeClient({
      apiKey: "k",
      apiBaseUrl: "https://x/api/v1",
      fetchFn,
    });
    const id = await client.ensureGatewayWorkspace("drime-s3");
    expect(id).toBe(5);
    expect(listCalls).toBe(1);
  });

  test("ensureGatewayWorkspace creates workspace when missing", async () => {
    const urls: string[] = [];
    const fetchFn: DrimeFetchFn = async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/me/workspaces")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (init?.method === "POST" && url.endsWith("/workspace")) {
        return new Response(
          JSON.stringify({ workspace: { id: 77, name: "drime-s3" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("?", { status: 404 });
    };
    const client = new DrimeClient({
      apiKey: "k",
      apiBaseUrl: "https://x/api/v1",
      fetchFn,
    });
    const id = await client.ensureGatewayWorkspace("drime-s3");
    expect(id).toBe(77);
    expect(urls.some((u) => u.includes("/me/workspaces"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/workspace"))).toBe(true);
  });

  test("resolveGatewayWorkspaceId throws when workspace missing", async () => {
    const fetchFn: DrimeFetchFn = async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const client = new DrimeClient({
      apiKey: "k",
      apiBaseUrl: "https://x/api/v1",
      fetchFn,
    });
    await expect(
      client.resolveGatewayWorkspaceId({ name: "drime-s3" }),
    ).rejects.toThrow(GatewayWorkspaceError);
  });
  test("getFileEntry unwraps fileEntry and parses description", async () => {
    const fetchFn: DrimeFetchFn = async (input) => {
      expect(String(input)).toContain("/file-entries/42");
      return new Response(
        JSON.stringify({
          fileEntry: {
            id: 42,
            name: "backup.bin",
            type: "text",
            parent_id: 7,
            file_size: 4,
            description: "md5:cccccccccccccccccccccccccccccccc-41",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const client = new DrimeClient({
      apiKey: "k",
      apiBaseUrl: "https://x/api/v1",
      fetchFn,
    });
    const entry = await client.getFileEntry(42);
    expect(entry.id).toBe(42);
    expect(entry.description).toBe("md5:cccccccccccccccccccccccccccccccc-41");
  });
});

describe("isInvalidEntryIdsError", () => {
  test("classifies the production 422 invalid-entry-ids body", () => {
    const error = new DrimeApiError(
      422,
      JSON.stringify({
        message: "The selected entry ids is invalid.",
        errors: { entryIds: ["The selected entry ids is invalid."] },
      }),
    );
    expect(isInvalidEntryIdsError(error)).toBe(true);
  });

  test("rejects other 422 validation bodies", () => {
    expect(
      isInvalidEntryIdsError(
        new DrimeApiError(
          422,
          JSON.stringify({ message: "The name field is required." }),
        ),
      ),
    ).toBe(false);
  });

  test("rejects the same body on another status", () => {
    expect(
      isInvalidEntryIdsError(
        new DrimeApiError(500, "selected entry ids is invalid"),
      ),
    ).toBe(false);
  });

  test("rejects non-Drime errors", () => {
    expect(
      isInvalidEntryIdsError(new Error("selected entry ids is invalid")),
    ).toBe(false);
    expect(isInvalidEntryIdsError(undefined)).toBe(false);
  });
});
