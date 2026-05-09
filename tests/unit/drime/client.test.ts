import { describe, expect, test } from "bun:test";
import { DrimeClient, type DrimeFetchFn } from "../../../src/drime/client";

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
});
