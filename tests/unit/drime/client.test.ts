import { describe, expect, test } from "bun:test";
import {
  DrimeClient,
  type DrimeFetchFn,
  GatewayWorkspaceError,
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
});
